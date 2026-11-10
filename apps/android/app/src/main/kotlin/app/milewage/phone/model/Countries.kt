package app.milewage.phone.model

import java.util.Locale

/** A country code from the server's settings in English words ("CA" is "Canada"), or the code itself. */
object Countries {
    fun name(code: String): String {
        if (code.length != 2) return code
        val name = runCatching { Locale.Builder().setRegion(code.uppercase()).build().getDisplayCountry(Locale.ENGLISH) }.getOrNull()
        return name?.takeIf { it.isNotBlank() && it != code.uppercase() } ?: code
    }
}
