// Shared models, formatting and the ports the Android modules implement. Plain Kotlin, no Android.
plugins {
    alias(libs.plugins.kotlin.jvm)
    // API models (app.milewage.core.api): kotlinx.serialization, which is multiplatform.
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
    // Multiplatform time zones (the instance's zone, never the device's).
    api(libs.kotlinx.datetime)
    api(libs.kotlinx.coroutines.core)
    // The API models and the request encoder (app.milewage.core.api).
    api(libs.kotlinx.serialization.json)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlin.test.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    // The contract drift check: request bodies and response fixtures against openapi.yaml.
    testImplementation(libs.json.schema.validator)
}
