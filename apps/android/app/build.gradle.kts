plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    // Screenshots of the screens on the JVM (Robolectric): ./gradlew :app:recordRoborazziDebug
    alias(libs.plugins.roborazzi)
    // Settings > Open-source licences: the list of libraries and their licences, made from the
    // dependencies at build time (res/raw/aboutlibraries.json), read by aboutlibraries-core.
    alias(libs.plugins.aboutlibraries)
}

// versionName is the repository's VERSION file, like every package.json and the Expo app.
val milewageVersion: String = providers.fileContents(
    rootProject.layout.projectDirectory.file("../../VERSION"),
).asText.get().trim()

// versionCode: MILEWAGE_VERSION_CODE, a whole number that grows with every build handed out.
// The Expo app's last release was 2, so the default is 3: this APK installs over it.
val maxVersionCode = 2_100_000_000 // Google Play's largest allowed versionCode
val milewageVersionCode: Int = providers.environmentVariable("MILEWAGE_VERSION_CODE").orNull
    .let { raw ->
        if (raw.isNullOrEmpty()) return@let 3
        val n = raw.toIntOrNull()
        require(raw.all(Char::isDigit) && n != null && n in 1..maxVersionCode) {
            "MILEWAGE_VERSION_CODE must be a whole number from 1 to $maxVersionCode, got \"$raw\""
        }
        n
    }

// Release signing: the upload key from the environment (scripts/phone-signing-env.sh exports these
// from $HOME/.milewage/keystore.env, made once by scripts/phone-keystore.sh). Without it the
// release build is signed with the debug key, so local builds still work.
val keystorePath: String? = providers.environmentVariable("MILEWAGE_KEYSTORE_PATH").orNull?.takeIf { it.isNotBlank() }

android {
    namespace = "app.milewage.phone"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        // The Expo app's id: the new app installs over it and keeps its place on the phone.
        applicationId = "app.milewage.phone"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = milewageVersionCode
        versionName = milewageVersion
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = providers.environmentVariable("MILEWAGE_KEYSTORE_PASSWORD").orNull
                keyAlias = providers.environmentVariable("MILEWAGE_KEY_ALIAS").orNull
                keyPassword = providers.environmentVariable("MILEWAGE_KEY_PASSWORD").orNull
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("boolean", "ANY_HTTP", "true")
        }
        release {
            // R8: shrink, optimize and obfuscate. Keep rules: proguard-rules.pro here, plus the
            // consumer rules shipped by :data and by Room, kotlinx.serialization, OkHttp and Navigation.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
            buildConfigField("boolean", "ANY_HTTP", "false")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        // A newer library or SDK is a decision (latest stable only), not a lint failure.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        // Robolectric (Compose UI tests and screenshots on the JVM) reads the app's resources.
        unitTests.isIncludeAndroidResources = true
        // Robolectric's native graphics draw full screens (and dialogs' windows) in memory.
        unitTests.all { it.maxHeapSize = "3g" }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        allWarningsAsErrors.set(true)
    }
}

// Manifest and dependency policy (09 section 5.3; replaces the Expo app's test/manifest.test.ts).
// The merged manifest may ask for these permissions and no others, and nothing from Google Play
// Services or Firebase may be on the runtime classpath: the app runs on de-Googled phones.
val policyPermissions = setOf(
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_LOCATION",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.POST_PROMOTED_NOTIFICATIONS",
    "android.permission.RECEIVE_BOOT_COMPLETED",
    "android.permission.CAMERA",
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    // :data NsdDiscovery: the Wi-Fi multicast lock older phones need to receive mDNS (normal, no prompt).
    "android.permission.CHANGE_WIFI_MULTICAST_STATE",
    // WorkManager's own scheduling.
    "android.permission.WAKE_LOCK",
    // androidx.core: a signature permission that keeps the app's own runtime receivers private.
    "app.milewage.phone.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
)
val policyForbiddenGroups = listOf("com.google.android.gms", "com.google.firebase", "com.google.mlkit", "com.google.android.play")

abstract class PolicyCheck : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val mergedManifest: RegularFileProperty

    @get:Input
    abstract val allowedPermissions: SetProperty<String>

    @get:Input
    abstract val runtimeModules: ListProperty<String>

    @get:Input
    abstract val forbiddenGroups: ListProperty<String>

    @get:OutputFile
    abstract val report: RegularFileProperty

    @TaskAction
    fun check() {
        val xml = mergedManifest.get().asFile.readText()
        val requested = Regex("""<uses-permission(?:-sdk-23)?\b[^>]*>""").findAll(xml)
            .map { it.value }
            .filterNot { "tools:node=\"remove\"" in it }
            .mapNotNull { Regex("""android:name="([^"]+)"""").find(it)?.groupValues?.get(1) }
            .toSortedSet()
        val extra = requested - allowedPermissions.get()
        val google = runtimeModules.get().filter { m -> forbiddenGroups.get().any { m.startsWith("$it:") || m.startsWith("$it.") } }
        report.get().asFile.writeText((requested.map { "permission $it" } + google.map { "forbidden $it" }).joinToString("\n"))
        if (extra.isNotEmpty() || google.isNotEmpty()) {
            throw GradleException(
                buildString {
                    if (extra.isNotEmpty()) append("Permissions outside the manifest policy: $extra. Add them to policyPermissions in app/build.gradle.kts only after deciding to. ")
                    if (google.isNotEmpty()) append("Google Play Services / Firebase on the runtime classpath: $google.")
                },
            )
        }
    }
}

androidComponents {
    onVariants { variant ->
        val name = variant.name.replaceFirstChar(Char::titlecase)
        val policy = tasks.register<PolicyCheck>("check${name}Policy") {
            mergedManifest.set(variant.artifacts.get(com.android.build.api.artifact.SingleArtifact.MERGED_MANIFEST))
            allowedPermissions.set(policyPermissions)
            forbiddenGroups.set(policyForbiddenGroups)
            runtimeModules.set(
                variant.runtimeConfiguration.incoming.resolutionResult.rootComponent.map { root ->
                    val seen = sortedSetOf<String>()
                    val queue = ArrayDeque(listOf(root))
                    while (queue.isNotEmpty()) {
                        queue.removeFirst().dependencies
                            .filterIsInstance<org.gradle.api.artifacts.result.ResolvedDependencyResult>()
                            .forEach { dep -> if (seen.add(dep.selected.id.displayName)) queue.add(dep.selected) }
                    }
                    seen.toList()
                },
            )
            report.set(layout.buildDirectory.file("reports/policy/$name.txt"))
        }
        tasks.matching { it.name == "assemble$name" || it.name == "check" }.configureEach { dependsOn(policy) }
    }
}

dependencies {
    implementation(project(":core"))
    implementation(project(":data"))
    implementation(project(":tracking"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.work.runtime)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.datetime)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    debugImplementation(libs.compose.ui.tooling)

    // The pairing scanner (QR codes are decoded by :data's ZXing analyzer; no ML Kit).
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.compose)
    implementation(libs.aboutlibraries.core)

    // Harmonises the earned and spent colours with the wallpaper colours when those are on.
    implementation(libs.material.color.utilities)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlin.test.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    // Compose UI tests and screenshots on the JVM (Robolectric, Roborazzi); no emulator.
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    debugImplementation(libs.compose.ui.test.manifest)
}
