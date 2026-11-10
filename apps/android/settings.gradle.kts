pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MileWage"

// Plain Kotlin (no Android): later the iPhone app shares these as Kotlin Multiplatform commonMain.
include(":engine")
include(":core")
// Android libraries and the app.
include(":data")
include(":tracking")
include(":app")
