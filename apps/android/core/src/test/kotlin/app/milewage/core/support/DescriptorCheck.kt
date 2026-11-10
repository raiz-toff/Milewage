package app.milewage.core.support

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.descriptors.PolymorphicKind
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
import tools.jackson.databind.JsonNode

/** Which way a model goes: the phone writes requests and reads responses. */
enum class Direction { REQUEST, RESPONSE }

/**
 * Compares a Kotlin model's serial descriptor with its schema in the contract, recursively:
 * - every Kotlin field exists in the schema under the same wire name (a rename or removal fails);
 * - the JSON types agree (integer, number, string, boolean, array, object, enum);
 * - requests: every field the schema requires is a field the model always writes, and the model's
 *   enum values are among the schema's;
 * - responses: a field the model cannot do without is required by the schema, a field the schema
 *   lets be null is nullable in the model, and the model knows every enum value the schema allows.
 * Fields the phone does not read may be missing from a response model (it is a slice).
 */
@OptIn(ExperimentalSerializationApi::class)
class DescriptorCheck(private val direction: Direction) {
    val problems = mutableListOf<String>()

    fun check(desc: SerialDescriptor, schemaIn: JsonNode, at: String) {
        val (schema, nullable) = unwrap(schemaIn)
        if (direction == Direction.RESPONSE && nullable && !desc.isNullable) {
            problems += "$at: the contract allows null, the model does not"
        }
        val types = types(schema)
        when (val kind = desc.kind) {
            PrimitiveKind.STRING -> expect(types, "string", at)
            PrimitiveKind.LONG, PrimitiveKind.INT, PrimitiveKind.SHORT, PrimitiveKind.BYTE -> expect(types, "integer", at)
            PrimitiveKind.DOUBLE, PrimitiveKind.FLOAT -> if ("number" !in types && "integer" !in types) problems += "$at: model is a number, contract says $types"
            PrimitiveKind.BOOLEAN -> expect(types, "boolean", at)
            SerialKind.ENUM -> checkEnum(desc, schema, at)
            StructureKind.LIST -> {
                expect(types, "array", at)
                schema.get("items")?.let { check(desc.getElementDescriptor(0), it, "$at[]") }
            }
            StructureKind.MAP -> expect(types, "object", at) // a JsonObject: free-form in the contract too
            StructureKind.CLASS, StructureKind.OBJECT -> checkObject(desc, schema, at)
            is PolymorphicKind, SerialKind.CONTEXTUAL, PrimitiveKind.CHAR -> problems += "$at: unsupported model kind $kind"
        }
    }

    private fun checkObject(desc: SerialDescriptor, schema: JsonNode, at: String) {
        if (desc.serialName == "kotlinx.serialization.json.JsonObject") return
        val types = types(schema)
        if ("object" !in types) {
            problems += "$at: model is an object, contract says $types"
            return
        }
        val props = schema.get("properties")
        val required = schema.get("required")?.values()?.map { it.asString() }?.toSet() ?: emptySet()
        val names = (0 until desc.elementsCount).map { desc.getElementName(it) }.toSet()
        for (i in 0 until desc.elementsCount) {
            val name = desc.getElementName(i)
            val element = desc.getElementDescriptor(i)
            val prop = props?.get(name)
            if (prop == null) {
                problems += "$at.$name: not in the contract (renamed or removed?)"
                continue
            }
            // With explicitNulls = false a nullable field is optional on the way in and left out when null.
            val optional = desc.isElementOptional(i) || element.isNullable
            if (direction == Direction.RESPONSE && !optional && name !in required) {
                problems += "$at.$name: the model needs it, the contract does not require it"
            }
            if (direction == Direction.REQUEST && name in required && optional) {
                problems += "$at.$name: the contract requires it, the model may leave it out"
            }
            check(element, prop, "$at.$name")
        }
        if (direction == Direction.REQUEST) {
            for (r in required) if (r !in names) problems += "$at.$r: required by the contract, missing from the model"
        }
    }

    private fun checkEnum(desc: SerialDescriptor, schema: JsonNode, at: String) {
        val model = (0 until desc.elementsCount).map { desc.getElementName(it) }.toSet()
        val contract = schema.get("enum")?.values()?.map { it.asString() }?.toSet()
            ?: schema.get("const")?.let { setOf(it.asString()) }
        if (contract == null) {
            problems += "$at: model is an enum, the contract is not"
            return
        }
        when (direction) {
            Direction.REQUEST -> (model - contract).takeIf { it.isNotEmpty() }?.let { problems += "$at: values not in the contract: $it" }
            Direction.RESPONSE -> (contract - model).takeIf { it.isNotEmpty() }?.let { problems += "$at: contract values the model cannot read: $it" }
        }
    }

    private fun expect(types: Set<String>, type: String, at: String) {
        if (type !in types) problems += "$at: model is $type, contract says $types"
    }

    /** The schema without `$ref` and without a `null` alternative; and whether null is allowed. */
    private fun unwrap(node: JsonNode): Pair<JsonNode, Boolean> {
        val n = Contract.resolve(node)
        val one = n.get("oneOf") ?: n.get("anyOf")
        if (one != null) {
            val nonNull = one.values().filter { types(Contract.resolve(it)) != setOf("null") }
            val nullable = nonNull.size < one.size()
            if (nonNull.size == 1) {
                val (inner, innerNullable) = unwrap(nonNull[0])
                return inner to (nullable || innerNullable)
            }
            return n to nullable
        }
        return n to ("null" in types(n))
    }

    /** The JSON types a schema allows; from `type`, else from `enum`/`const`, else from its shape. */
    private fun types(n: JsonNode): Set<String> {
        val t = n.get("type")
        if (t != null) return if (t.isArray) t.values().map { it.asString() }.toSet() else setOf(t.asString())
        val values: Collection<JsonNode>? = n.get("enum")?.values() ?: n.get("const")?.let { listOf(it) }
        if (values != null) {
            return values.map {
                when {
                    it.isNull -> "null"
                    it.isString -> "string"
                    it.isIntegralNumber -> "integer"
                    it.isNumber -> "number"
                    it.isBoolean -> "boolean"
                    else -> "object"
                }
            }.toSet()
        }
        if (n.has("properties")) return setOf("object")
        return emptySet()
    }
}
