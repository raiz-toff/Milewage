package app.milewage.phone.logic

import kotlin.test.Test
import kotlin.test.assertEquals

class TripMarksTest {
    private fun marks(purpose: String, estimated: Boolean = true, added: Boolean = false, kind: String? = "Deadhead") =
        TripMarks.of(kind, purpose, estimated, added, estimatedWord = "estimated", addedWord = "added")

    @Test
    fun `a purpose that already says estimated is not followed by the word again`() {
        assertEquals(listOf("Deadhead", "Between deliveries (estimated)"), marks("Between deliveries (estimated)"))
    }

    @Test
    fun `an estimated trip whose purpose does not say so gets the word`() {
        assertEquals(listOf("Deadhead", "Deliveries", "estimated"), marks("Deliveries"))
        assertEquals(listOf("Deadhead", "estimated"), marks("  "))
    }

    @Test
    fun `a trip the driver added says added, never estimated`() {
        assertEquals(listOf("Business", "Bank run", "added"), marks("Bank run", estimated = false, added = true, kind = "Business"))
    }
}
