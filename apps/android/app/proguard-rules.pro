# R8 keep rules for the app. Libraries ship their own (Room, kotlinx.serialization, OkHttp,
# Navigation, Compose, WorkManager, DataStore); :data adds its own in data/consumer-rules.pro.

# Navigation routes are @Serializable classes looked up through their generated serializers.
-keep @kotlinx.serialization.Serializable class app.milewage.phone.ui.nav.** { *; }

# Crash reports stay readable: keep file names and line numbers, hide the original source file name.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
