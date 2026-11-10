package app.milewage.core.support

import com.networknt.schema.SchemaRegistry
import com.networknt.schema.SpecificationVersion
import kotlinx.serialization.json.JsonElement
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ArrayNode
import tools.jackson.databind.node.JsonNodeFactory
import tools.jackson.databind.node.ObjectNode
import tools.jackson.dataformat.yaml.YAMLMapper
import java.io.File

/**
 * packages/shared/openapi/openapi.yaml, THE contract (decision 2026-11-04), read straight from the
 * repository by relative path (Gradle runs the tests in apps/android/core). OpenAPI 3.1 schemas are
 * JSON Schema 2020-12, so a request body or a fixture is checked with a JSON Schema validator after
 * moving `components.schemas` under `$defs` (as scripts/openapi-generate.mjs does for schemas.json).
 */
object Contract {
    val file: File = File("../../../packages/shared/openapi/openapi.yaml")

    val spec: JsonNode by lazy {
        check(file.isFile) { "the contract is not at ${file.absolutePath}" }
        YAMLMapper().readTree(file.readText())
    }

    private val json = JsonMapper()
    private val registry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12)

    /** components.schemas, refs rewritten and `allOf` of objects merged (see [mergeAllOf]). */
    val defs: ObjectNode by lazy {
        val raw = rewriteRefs(spec.path("components").path("schemas")) as ObjectNode
        val out = JsonNodeFactory.instance.objectNode()
        for (name in raw.propertyNames()) out.set(name, mergeAllOf(raw.get(name), raw))
        out
    }

    /** The operation at [path] and [method] (lower case), or null when the spec has none. */
    fun operation(method: String, path: String): JsonNode? =
        spec.path("paths").path(path).path(method.lowercase()).takeIf { it.isObject }

    fun requestSchema(method: String, path: String): JsonNode? =
        operation(method, path)?.path("requestBody")?.path("content")?.path("application/json")?.path("schema")?.takeIf { it.isObject }

    fun responseSchema(method: String, path: String, status: Int): JsonNode? =
        operation(method, path)?.path("responses")?.path(status.toString())?.path("content")?.path("application/json")
            ?.path("schema")?.takeIf { it.isObject }

    fun component(name: String): JsonNode = defs.get(name) ?: error("no schema $name in the contract")

    /** The validation errors of [instance] against [schema] (an operation's schema, refs unresolved). */
    fun validate(schema: JsonNode, instance: JsonElement): List<String> {
        val root = JsonNodeFactory.instance.objectNode()
        root.put("\$schema", "https://json-schema.org/draft/2020-12/schema")
        val local = mergeAllOf(rewriteRefs(schema), defs)
        (local as? ObjectNode)?.properties()?.forEach { (k, v) -> root.set(k, v) }
        root.set("\$defs", defs)
        return registry.getSchema(root).validate(json.readTree(instance.toString())).map { "${it.instanceLocation}: ${it.message}" }
    }

    /** Follows `$ref`s into [defs]. */
    fun resolve(node: JsonNode): JsonNode {
        var n = node
        repeat(20) {
            val ref = n.path("\$ref").takeIf { it.isString }?.asString() ?: return n
            n = defs.get(ref.removePrefix("#/\$defs/").removePrefix("#/components/schemas/")) ?: error("unknown \$ref $ref")
        }
        return n
    }

    private fun rewriteRefs(node: JsonNode): JsonNode =
        json.readTree(node.toString().replace("#/components/schemas/", "#/\$defs/"))

    /**
     * `allOf` of object schemas merged into one object (properties and required united,
     * `additionalProperties: false` kept when a member has it). Strict JSON Schema would refuse
     * ManualTripPut's own `edited_at`, because TripCreate in its `allOf` says
     * `additionalProperties: false`; the server (apps/server/src/routes/trips.ts) and the generated
     * TypeScript (an intersection) read it as the merged object, and so does this check.
     */
    private fun mergeAllOf(node: JsonNode, defs: ObjectNode): JsonNode {
        if (node is ArrayNode) {
            val out = JsonNodeFactory.instance.arrayNode()
            node.values().forEach { out.add(mergeAllOf(it, defs)) }
            return out
        }
        if (node !is ObjectNode) return node
        val copy = JsonNodeFactory.instance.objectNode()
        for ((k, v) in node.properties()) copy.set(k, mergeAllOf(v, defs))
        val all = copy.get("allOf") as? ArrayNode ?: return copy
        val members = ArrayList<JsonNode>()
        for (m in all.values()) {
            var r: JsonNode = m
            while (r.has("\$ref")) r = defs.get(r.get("\$ref").asString().removePrefix("#/\$defs/")) ?: return copy
            members.add(mergeAllOf(r, defs))
        }
        if (members.any { it.has("allOf") || it.has("oneOf") || it.has("anyOf") }) return copy
        val merged = JsonNodeFactory.instance.objectNode()
        merged.put("type", "object")
        val props = JsonNodeFactory.instance.objectNode()
        val required = linkedSetOf<String>()
        var closed = false
        for (m in members) {
            (m.get("properties") as? ObjectNode)?.properties()?.forEach { (k, v) -> props.set(k, v) }
            m.get("required")?.values()?.forEach { required += it.asString() }
            if (m.get("additionalProperties")?.isBoolean == true && !m.get("additionalProperties").asBoolean()) closed = true
        }
        merged.set("properties", props)
        merged.set("required", JsonNodeFactory.instance.arrayNode().also { a -> required.forEach { a.add(it) } })
        if (closed) merged.put("additionalProperties", false)
        for ((k, v) in copy.properties()) if (k != "allOf" && k != "type") merged.set(k, v)
        return merged
    }
}
