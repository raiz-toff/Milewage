package app.milewage.core.api

import app.milewage.core.support.Contract
import app.milewage.core.support.ContractFixtures
import app.milewage.core.support.DescriptorCheck
import app.milewage.core.support.Direction
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * "OpenAPI is the contract; drift fails CI" (decision 2026-11-04) for the phone's hand-written models.
 * Reads packages/shared/openapi/openapi.yaml from the repository and fails when it and the Kotlin
 * disagree:
 * 1. every operation in [Api.all] exists at its path and method with the same operationId;
 * 2. every request model and every response model matches its schema field by field (wire names,
 *    types, required, nullable, enum values; see DescriptorCheck);
 * 3. a contract-valid answer for every status the phone reads (ContractFixtures) decodes with the model;
 * 4. what the phone sends validates against the request schema (here for pairing, linking and
 *    diagnostics; ShiftRequestsTest for every shift change and the point batch).
 * Rename a field in Models.kt or in the spec and this test names it.
 */
class ContractDriftTest {
    @Test
    fun everyOperationThePhoneCallsIsInTheContract() {
        val problems = mutableListOf<String>()
        for (e in Api.all) {
            val op = Contract.operation(e.method.name, e.path)
            if (op == null) {
                problems += "$e: no such path and method in the contract"
                continue
            }
            val id = op.path("operationId").asString()
            if (id != e.operationId) problems += "$e: the contract calls it $id"
            if (e.request != null && Contract.requestSchema(e.method.name, e.path) == null) problems += "$e: the contract takes no JSON body"
            if (e.request == null && Contract.requestSchema(e.method.name, e.path) != null) problems += "$e: the contract wants a body"
            for (status in e.bodyStatuses + e.emptyStatuses) {
                if (op.path("responses").path(status.toString()).isMissingNode) problems += "$e: no $status answer in the contract"
            }
            val servers = op.path("servers").takeIf { !it.isMissingNode } ?: Contract.spec.path("paths").path(e.path).path("servers")
            if (e.root != (servers.firstOrNull()?.path("url")?.asString() == "/")) problems += "$e: root/api placement differs from the contract"
        }
        assertEquals(emptyList(), problems)
    }

    @Test
    fun everyModelMatchesItsSchemaFieldByField() {
        val problems = mutableListOf<String>()
        for (e in Api.all) {
            e.request?.let { req ->
                val schema = Contract.requestSchema(e.method.name, e.path) ?: return@let
                problems += DescriptorCheck(Direction.REQUEST).also { it.check(req.descriptor, schema, "${e.operationId} request") }.problems
            }
            val answers = e.bodyStatuses.map { it to e.response } + e.otherBodies.toList()
            for ((status, serializer) in answers) {
                val schema = Contract.responseSchema(e.method.name, e.path, status)
                if (schema == null) {
                    problems += "${e.operationId} $status: no JSON answer in the contract"
                    continue
                }
                problems += DescriptorCheck(Direction.RESPONSE).also { it.check(serializer.descriptor, schema, "${e.operationId} $status") }.problems
            }
        }
        problems += DescriptorCheck(Direction.RESPONSE).also { it.check(Problem.serializer().descriptor, Contract.component("Problem"), "Problem") }.problems
        assertEquals(emptyList(), problems, problems.joinToString("\n"))
    }

    @Test
    fun aContractValidAnswerForEveryStatusDecodesWithTheModel() {
        val problems = mutableListOf<String>()
        val covered = mutableSetOf<String>()
        for (e in Api.all) {
            val answers: List<Pair<Int, KSerializer<*>>> = e.bodyStatuses.map { it to e.response } + e.otherBodies.toList()
            for ((status, serializer) in answers) {
                val key = "${e.operationId} $status"
                val fixtures = ContractFixtures.answers[key]
                if (fixtures == null) {
                    problems += "$key: no fixture in ContractFixtures"
                    continue
                }
                covered += key
                val schema = assertNotNull(Contract.responseSchema(e.method.name, e.path, status), key)
                for ((i, text) in fixtures.withIndex()) {
                    val element = ApiJson.parseToJsonElement(text)
                    Contract.validate(schema, element).forEach { problems += "$key #$i is not what the contract says: $it" }
                    runCatching { ApiJson.decodeFromJsonElement(serializer, element) }
                        .onFailure { problems += "$key #$i does not decode: ${it.message}" }
                }
            }
        }
        val unused = ContractFixtures.answers.keys - covered
        assertTrue(unused.isEmpty(), "fixtures for no endpoint: $unused")
        val problem = ApiJson.parseToJsonElement(ContractFixtures.PROBLEM)
        Contract.validate(Contract.component("Problem"), problem).forEach { problems += "Problem fixture: $it" }
        val decoded = ApiJson.decodeFromJsonElement(Problem.serializer(), problem)
        assertEquals("validation_failed" to "/purpose", decoded.code to decoded.errors.single().path)
        assertEquals(emptyList(), problems, problems.joinToString("\n"))
    }

    @Test
    fun theDecodedAnswersCarryTheValues() {
        val s = ApiJson.decodeFromString(Settings.serializer(), ContractFixtures.SETTINGS)
        assertEquals(DistanceUnit.KM, s.distanceUnit)
        assertEquals(30.5, s.ownMileageRate?.centsPerUnit)
        assertEquals(1, s.weekStart)
        assertEquals(DiagnosticsLevel.VERBOSE, s.diagnostics.level)
        assertEquals(3, s.diagnostics.capture?.maxShifts)
        assertEquals(true, s.modules.tracking)
        val end = ApiJson.decodeFromString(EndShiftResult.serializer(), ContractFixtures.answers.getValue("endShift 200")[0])
        assertEquals(12000, end.shift.totalM)
        assertEquals(100, end.recon?.diffM)
        assertEquals(end, ApiJson.decodeFromString(EndShiftResult.serializer(), ApiJson.encodeToString(EndShiftResult.serializer(), end)))
        val changes = ApiJson.decodeFromString(SyncChanges.serializer(), ContractFixtures.answers.getValue("pullChanges 200")[0])
        val shift = ApiJson.decodeFromJsonElement(Shift.serializer(), changes.changes[0].data!!)
        assertEquals(ShiftStatus.ENDED, shift.status)
        assertEquals(1_700_003_600_000, shift.endedAt) // epoch ms: Long, never Int
    }

    @Test
    fun whatThePhoneSendsBeforePairingAndForDiagnosticsIsWhatTheContractTakes() {
        fun <T> accepts(e: Endpoint<T, *>, body: T): List<String> =
            Contract.validate(Contract.requestSchema(e.method.name, e.path)!!, ApiJson.encodeToJsonElement(e.request!!, body))
        val token = "mwp_" + "a".repeat(43)
        assertEquals(emptyList(), accepts(Api.redeem, RedeemRequest(token, "Pixel 8", DevicePlatform.ANDROID, "0.3.0")))
        assertEquals(emptyList(), accepts(Api.redeem, RedeemRequest(token, "Pixel 8", DevicePlatform.ANDROID)))
        assertEquals(emptyList(), accepts(Api.startLink, LinkRequestCreate("Android phone", DevicePlatform.ANDROID)))
        assertEquals(emptyList(), accepts(Api.pollLink, LinkPoll("mwl_" + "c".repeat(43))))
        val event = DiagEventIn(
            kind = "shift.summary", at = 1_700_000_000_000, level = DiagEventLevel.BASIC, src = DiagSource.PHONE_NATIVE,
            seq = 1, shift = "11111111-1111-4111-8111-111111111111", v = "0.3.0", data = buildJsonObject { put("fixes", 10) },
        )
        assertEquals(emptyList(), accepts(Api.diagnostics, DiagIngestRequest(listOf(event))))
        // The validator refuses what the server refuses, so a pass above means something.
        assertTrue(accepts(Api.redeem, RedeemRequest(token, "x".repeat(65), DevicePlatform.ANDROID)).isNotEmpty())
        assertTrue(accepts(Api.diagnostics, DiagIngestRequest(listOf(event.copy(kind = "Bad Kind")))).isNotEmpty())
        assertTrue(accepts(Api.diagnostics, DiagIngestRequest(emptyList())).isNotEmpty())
        val extra: JsonElement = buildJsonObject {
            put("device_code", "x")
            put("extra", 1)
        }
        assertTrue(Contract.validate(Contract.requestSchema("POST", "/link-requests/poll")!!, extra).isNotEmpty())
    }

    @Test
    fun theContractIsWhereTheTestLooks() {
        if (!Contract.file.isFile) fail("packages/shared/openapi/openapi.yaml not found from ${java.io.File(".").absolutePath}")
        assertEquals("3.1.0", Contract.spec.path("openapi").asString())
    }
}
