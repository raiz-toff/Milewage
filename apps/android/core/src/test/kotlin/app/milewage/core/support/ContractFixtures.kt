package app.milewage.core.support

/**
 * One full, contract-valid answer per operation and status the phone reads, keyed
 * `<operationId> <status>`. ContractDriftTest validates each against openapi.yaml (so a fixture
 * is what a current server may send) and decodes it with the phone's model (so the phone reads it).
 * When the spec changes an answer, update the fixture here first: the test then says which model
 * must follow.
 */
object ContractFixtures {
    private const val SHIFT_ID = "11111111-1111-4111-8111-111111111111"
    private val deviceToken = "mwd_" + "b".repeat(43)

    val SETTINGS = """
        {"country":"CA","distance_unit":"km","currency":"CAD","timezone":"America/Toronto",
         "raw_retention_days":90,"stops_enabled":true,"help_enabled":true,"display_name":"Sam","region":"ON",
         "logbook":{"readings":"Start and end of the year","notes":["Keep the log for six years."]},
         "own_mileage_rate":{"cents_per_unit":30.5,"unit":"km"},"mileage_rate":"official","week_start":1,
         "time_format":"24h","default_vehicle_id":3,"work_kinds":["delivery","ride_hailing"],
         "onboarded_at":1700000000000,"setup_done":["vehicle","phone"],"engine_version":4,
         "diagnostics":{"level":"verbose","verbose_until":1700086400000,
           "capture":{"id":2,"profile":"dense","expires_at":1700600000000,"max_shifts":3,"shifts_done":1}},
         "modules":{"notifications":true,"import":true,"maintenance":true,
           "analytics":true,"goals":true,"tax":true,"receipts":true,"expenses":true,"earnings":true,
           "platforms":true,"devices":true,"tracking":true,"replay":true,"stops":true,"sync":true,
           "diagnostics":true,"capture":true,"mcp":true,"backup_download":true,"local_export":false,
           "exporters":["csv","pdf","gpx"],"countries":["CA","US"]}}
    """.trimIndent()

    val SHIFT = """
        {"id":12,"client_id":"$SHIFT_ID","vehicle_id":3,"status":"ended","segmenter":"stops",
         "started_at":1700000000000,"ended_at":1700003600000,"local_date":"2023-11-14","total_m":12000,
         "active_m":8000,"deadhead_m":3000,"personal_m":1000,"calc_version":4,"calculated_at":1700003601000,
         "notes":null,"deduction_cents":840,"updated_at":1700003601000,"recon_status":"match",
         "recon_reasons":[],"calc_mismatch":false,"flags":[{"code":"long_gap","severity":"review","detail":{"gap_s":900}}],
         "overlaps_shift_id":null}
    """.trimIndent()

    private val ACTIVE_SHIFT = """
        {"id":13,"client_id":"22222222-2222-4222-8222-222222222222","vehicle_id":3,"status":"active",
         "segmenter":"whole_shift","started_at":1700100000000,"ended_at":null,"local_date":"2023-11-15",
         "total_m":null,"active_m":null,"deadhead_m":null,"personal_m":null,"calc_version":null,
         "calculated_at":null,"notes":"Airport run","deduction_cents":null}
    """.trimIndent()

    private val TRIP = """
        {"id":40,"shift_id":12,"trip_key":"$SHIFT_ID:1700000000000:active","kind":"personal","original_kind":"active",
         "source":"auto","started_at":1700000000000,"ended_at":1700000900000,"start_lat_e7":436532000,
         "start_lon_e7":-793832000,"end_lat_e7":null,"end_lon_e7":null,"distance_m":4200,"purpose":"Lunch",
         "edited_at":1700003700000}
    """.trimIndent()

    private val PAIRED = """
        {"device_id":7,"device_token":"$deviceToken","settings":$SETTINGS,
         "home_url":"http://192.168.1.20:8080","away_url":"https://box.tail1234.ts.net"}
    """.trimIndent()

    /** `<operationId> <status>` to the answers the phone must read (each validated and decoded). */
    val answers: Map<String, List<String>> = mapOf(
        "getHealth 200" to listOf("""{"ok":true}"""),
        "redeemPairingToken 201" to listOf(
            PAIRED,
            // An older server: no home or away address.
            """{"device_id":7,"device_token":"$deviceToken","settings":$SETTINGS}""",
        ),
        "createLinkRequest 201" to listOf("""{"device_code":"mwl_${"c".repeat(43)}","user_code":"482913","expires_in":600,"interval":5}"""),
        "pollLinkRequest 201" to listOf(
            PAIRED,
            """{"device_id":9,"device_token":"$deviceToken","settings":$SETTINGS,"home_url":null,"away_url":null}""",
        ),
        "pollLinkRequest 202" to listOf("""{"status":"pending"}"""),
        "getSettings 200" to listOf(
            SETTINGS,
            SETTINGS.replace(""""own_mileage_rate":{"cents_per_unit":30.5,"unit":"km"}""", """"own_mileage_rate":null""")
                .replace(""""logbook":{"readings":"Start and end of the year","notes":["Keep the log for six years."]}""", """"logbook":null"""),
        ),
        "listVehicles 200" to listOf(
            """[{"id":3,"name":"Civic","kind":"car","make":"Honda","model":"Civic","year":2019,"plate":null,"power":"gas",
                "ownership":"owned","created_at":1690000000000,"archived_at":null},
               {"id":4,"name":"Bike","kind":"ebike","make":null,"model":null,"year":null,"plate":null,"power":null,
                "ownership":"rented","created_at":1690000000000,"archived_at":null}]""",
            "[]",
        ),
        "startShift 200" to listOf(ACTIVE_SHIFT),
        "startShift 201" to listOf(ACTIVE_SHIFT),
        "updateShift 200" to listOf(SHIFT),
        "setShiftOdometer 200" to listOf("""{"id":5,"vehicle_id":3,"shift_id":12,"kind":"shift_start","reading_m":12345678,"recorded_at":1700000000000}"""),
        "putTripOverride 200" to listOf("""{"trip":$TRIP,"shift":$SHIFT}""", """{"trip":null,"shift":$SHIFT}"""),
        "putManualTrip 200" to listOf("""{"trip":${TRIP.replace("\"source\":\"auto\"", "\"source\":\"manual\"")},"shift":$SHIFT}"""),
        "endShift 200" to listOf(
            SHIFT.dropLast(1) + ""","recon":{"status":"differs","server_total_m":12100,"diff_m":100,"reasons":["late_points"]}}""",
            SHIFT,
        ),
        "uploadTelemetryBatch 200" to listOf(
            """{"inserted":2,"duplicates":1,"rejected":[{"seq":3,"code":"future_timestamp"}],"server_time":1700000000000,"upload_hint_s":60}""",
        ),
        "pullChanges 200" to listOf(
            """{"changes":[{"seq":1,"entity":"shift","op":"upsert","key":"$SHIFT_ID","data":$SHIFT},
                           {"seq":2,"entity":"trip","op":"delete","key":"40","data":null},
                           {"seq":3,"entity":"settings","op":"upsert","key":"settings","data":$SETTINGS}],
                "next_cursor":3,"has_more":false}""",
        ),
        "ingestDiagnosticEvents 200" to listOf("""{"accepted":2,"duplicates":0,"discarded":0,"rejected":[{"index":1,"reason":"unknown_kind"}]}"""),
    )

    val PROBLEM = """
        {"type":"/api/v1/errors/validation_failed","title":"Validation failed","status":422,"code":"validation_failed",
         "detail":"purpose is too short","retryable":false,"request_id":"r-1","errors":[{"path":"/purpose","message":"too short"}]}
    """.trimIndent()
}
