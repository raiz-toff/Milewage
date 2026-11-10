package app.milewage.core.connect

/**
 * The phone side of the network: what the connect logic asks the platform. `AndroidNet` in :data
 * implements it with ConnectivityManager, NsdManager and the package manager; tests use a fake.
 * A port of the Expo app's `NetPort` (connect/reach.ts) over `native/net-check`.
 */
interface NetPort {
    /** True when this phone's traffic goes through a VPN (Tailscale); null when it cannot tell. */
    suspend fun vpnActive(): Boolean?

    /** True on Wi-Fi or Ethernet, false on mobile data alone, null when it cannot tell (plan 28). */
    suspend fun localNetwork(): Boolean?

    /** MileWage servers announced on this Wi-Fi; empty when none or when discovery is not possible. */
    suspend fun discover(): List<FoundServer>

    suspend fun tailscaleInstalled(): Boolean

    /** Opens Tailscale, or its store page when it is not installed. */
    suspend fun openTailscale()
}

/** The transports of a network, as Android's NetworkCapabilities reports them. */
enum class NetTransport { WIFI, ETHERNET, CELLULAR, VPN, BLUETOOTH, OTHER }

/**
 * Reading the active network. Android gives a VPN network the transports of the network under it
 * too (Tailscale over Wi-Fi also has WIFI), so a VPN does not hide that the phone is on Wi-Fi, and
 * only VPN says a VPN is on. Null transports: no active network.
 */
object NetState {
    /** Wi-Fi or Ethernet (also under a VPN): the home address may answer. Null with no network. */
    fun localNetwork(transports: Set<NetTransport>?): Boolean? =
        transports?.let { NetTransport.WIFI in it || NetTransport.ETHERNET in it }

    fun vpnActive(transports: Set<NetTransport>?): Boolean? = transports?.let { NetTransport.VPN in it }

    /** Tailscale's Android package (only it is named under `<queries>`). */
    const val TAILSCALE = "com.tailscale.ipn"
}
