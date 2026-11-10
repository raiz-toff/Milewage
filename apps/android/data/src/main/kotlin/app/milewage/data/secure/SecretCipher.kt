package app.milewage.data.secure

import java.security.GeneralSecurityException
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * AES-256-GCM envelope for one small secret: `base64(version || iv || ciphertext+tag)`. The name the
 * secret is stored under is the associated data, so a value copied to another name does not open.
 * The key comes from [key] (the Android Keystore in the app, a plain key in tests); it never leaves
 * the Keystore, the cipher only asks it to encrypt or decrypt.
 */
class SecretCipher(private val key: () -> SecretKey) {
    fun seal(name: String, plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        // The Keystore picks a fresh random IV itself (callers may not choose one for GCM keys).
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        val iv = cipher.iv
        check(iv.size == IV_BYTES) { "unexpected GCM IV length ${iv.size}" }
        val sealed = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(byteArrayOf(VERSION) + iv + sealed)
    }

    /** The secret, or null when the value is damaged, was sealed under another name, or the key is gone. */
    fun open(name: String, sealed: String): String? = try {
        val bytes = Base64.getDecoder().decode(sealed)
        if (bytes.size <= 1 + IV_BYTES || bytes[0] != VERSION) {
            null
        } else {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, bytes, 1, IV_BYTES))
            cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
            String(cipher.doFinal(bytes, 1 + IV_BYTES, bytes.size - 1 - IV_BYTES), Charsets.UTF_8)
        }
    } catch (_: GeneralSecurityException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val VERSION: Byte = 1
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}
