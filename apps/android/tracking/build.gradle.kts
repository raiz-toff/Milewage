// The Android side of tracking: the location foreground service, its notifications, the
// receivers (buttons, alarms, boot) and the controller the app calls. Every decision (what to
// request, what to store, still or moving) is plain Kotlin in :core
// (app.milewage.core.tracking) and tested there; this module only applies it.
plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "app.milewage.tracking"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        minSdk = libs.versions.minSdk.get().toInt()
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = true
        // A newer library or SDK is a decision (latest stable only), not a lint failure.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        allWarningsAsErrors.set(true)
    }
}

dependencies {
    api(project(":core"))
    // TODO(engine): the live distance switches to :engine's createLiveAccumulator once the port
    // lands (see LiveDistance in :core); until then :tracking does not depend on :engine.
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlin.test.junit)
}
