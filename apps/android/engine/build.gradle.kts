// The track engine: a port of packages/track-engine. Plain Kotlin on the JVM, no Android.
plugins {
    alias(libs.plugins.kotlin.jvm)
    // The models are @Serializable with the TypeScript field names; kotlinx.serialization is
    // multiplatform, so this survives the move to commonMain.
    alias(libs.plugins.kotlin.serialization)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        allWarningsAsErrors.set(true)
    }
}

dependencies {
    api(libs.kotlinx.serialization.json)

    // kotlin-test: the assertions work unchanged in a Kotlin Multiplatform commonTest later.
    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlin.test.junit)
}

tasks.test {
    // The large cross-check files (tools/README in engine/README.md) are big; give the JVM room.
    maxHeapSize = "2g"
    testLogging {
        events("failed")
        showStandardStreams = true
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
