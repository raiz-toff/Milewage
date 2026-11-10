// The track engine: a port of packages/track-engine. Plain Kotlin on the JVM, no Android.
plugins {
    alias(libs.plugins.kotlin.jvm)
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
    // kotlin-test: the assertions work unchanged in a Kotlin Multiplatform commonTest later.
    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlin.test.junit)
}
