package app.milewage.data.secure

import java.util.Base64
import javax.crypto.KeyGenerator
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull

/** The envelope with a plain AES key; on the phone the same cipher runs on an Android Keystore key. */
class SecretCipherTest {
    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val cipher = SecretCipher { key }

    @Test
    fun opensWhatItSealed() {
        val sealed = cipher.seal("device_token", "mw_dev_123")
        assertEquals("mw_dev_123", cipher.open("device_token", sealed))
    }

    @Test
    fun eachSealUsesAFreshIv() {
        assertNotEquals(cipher.seal("a", "same"), cipher.seal("a", "same"))
    }

    @Test
    fun aValueMovedToAnotherNameDoesNotOpen() {
        val sealed = cipher.seal("device_token", "mw_dev_123")
        assertNull(cipher.open("pairing_key", sealed))
    }

    @Test
    fun damagedOrForeignValuesGiveNull() {
        val bytes = Base64.getDecoder().decode(cipher.seal("a", "secret"))
        bytes[bytes.size - 1] = (bytes[bytes.size - 1].toInt() xor 1).toByte()
        assertNull(cipher.open("a", Base64.getEncoder().encodeToString(bytes)))
        assertNull(cipher.open("a", "not base64 !"))
        assertNull(cipher.open("a", ""))
        val otherKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        assertNull(SecretCipher { otherKey }.open("a", cipher.seal("a", "secret")))
    }
}
