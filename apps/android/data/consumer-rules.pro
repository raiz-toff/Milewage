# Rules the app's R8 needs for :data. Room 3, kotlinx.serialization, OkHttp, DataStore and WorkManager
# ship their own consumer rules; these cover MileWage's own classes that are reached by reflection.

# Room creates the generated database implementation by name (MileWageDatabase_Impl).
-keep class * extends androidx.room3.RoomDatabase { <init>(); }

# API models are (de)serialized by their generated serializers; keep them with their companions.
-keepclassmembers @kotlinx.serialization.Serializable class app.milewage.** {
    static ** Companion;
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class app.milewage.**$$serializer { *; }
