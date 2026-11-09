package app.jard.engine

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings
import org.json.JSONObject
import java.io.File
import java.math.BigInteger
import java.security.MessageDigest

/** Ed25519 signature checking (RFC 8032). minSdk 26 has no built-in Ed25519, and one check takes moments. */
internal object Ed25519 {
    private val P = BigInteger.TWO.pow(255) - BigInteger.valueOf(19)
    private val L = BigInteger.TWO.pow(252) + BigInteger("27742317777372353535851937790883648493")
    private val D = BigInteger.valueOf(-121665) * BigInteger.valueOf(121666).modInverse(P)
    private val I = BigInteger.TWO.modPow((P - BigInteger.ONE) / BigInteger.valueOf(4), P)
    private val BY = BigInteger.valueOf(4) * BigInteger.valueOf(5).modInverse(P)
    private val BX = recoverX(BY, false)!!
    private val BASE = Point(BX, BY.mod(P), BigInteger.ONE, (BX * BY).mod(P))

    private class Point(val x: BigInteger, val y: BigInteger, val z: BigInteger, val t: BigInteger)

    private fun recoverX(y: BigInteger, sign: Boolean): BigInteger? {
        if (y >= P) return null
        val x2 = (y * y - BigInteger.ONE) * (D * y * y + BigInteger.ONE).modInverse(P)
        if (x2.mod(P) == BigInteger.ZERO) return if (sign) null else BigInteger.ZERO
        var x = x2.modPow((P + BigInteger.valueOf(3)) / BigInteger.valueOf(8), P)
        if ((x * x - x2).mod(P) != BigInteger.ZERO) x = (x * I).mod(P)
        if ((x * x - x2).mod(P) != BigInteger.ZERO) return null
        if (x.testBit(0) != sign) x = P - x
        return x
    }

    private fun add(a: Point, b: Point): Point {
        val two = BigInteger.TWO
        val aa = ((a.y - a.x) * (b.y - b.x)).mod(P)
        val bb = ((a.y + a.x) * (b.y + b.x)).mod(P)
        val c = (two * a.t * b.t * D).mod(P)
        val d = (two * a.z * b.z).mod(P)
        val e = bb - aa
        val f = d - c
        val g = d + c
        val h = bb + aa
        return Point((e * f).mod(P), (g * h).mod(P), (f * g).mod(P), (e * h).mod(P))
    }

    private fun multiply(s: BigInteger, p: Point): Point {
        var q = Point(BigInteger.ZERO, BigInteger.ONE, BigInteger.ONE, BigInteger.ZERO)
        var cur = p
        var k = s
        while (k.signum() > 0) {
            if (k.testBit(0)) q = add(q, cur)
            cur = add(cur, cur)
            k = k.shiftRight(1)
        }
        return q
    }

    private fun littleEndian(bytes: ByteArray) = BigInteger(1, bytes.reversedArray())

    private fun decompress(bytes: ByteArray): Point? {
        if (bytes.size != 32) return null
        val sign = bytes[31].toInt() and 0x80 != 0
        val copy = bytes.copyOf().also { it[31] = (it[31].toInt() and 0x7f).toByte() }
        val y = littleEndian(copy)
        val x = recoverX(y, sign) ?: return null
        return Point(x, y, BigInteger.ONE, (x * y).mod(P))
    }

    private fun sameEncoding(a: Point, b: Point): Boolean =
        (a.x * b.z - b.x * a.z).mod(P) == BigInteger.ZERO && (a.y * b.z - b.y * a.z).mod(P) == BigInteger.ZERO

    fun verify(publicKey: ByteArray, message: ByteArray, signature: ByteArray): Boolean {
        if (publicKey.size != 32 || signature.size != 64) return false
        val a = decompress(publicKey) ?: return false
        val r = decompress(signature.copyOfRange(0, 32)) ?: return false
        val s = littleEndian(signature.copyOfRange(32, 64))
        if (s >= L) return false
        val h = MessageDigest.getInstance("SHA-512").run {
            update(signature, 0, 32)
            update(publicKey)
            update(message)
            digest()
        }
        val k = littleEndian(h).mod(L)
        return sameEncoding(multiply(s, BASE), add(r, multiply(k, a)))
    }
}

sealed class KeyCheck {
    data class Ok(val key: String) : KeyCheck()
    data class Short(val missing: Int) : KeyCheck()
    data class Long(val extra: Int) : KeyCheck()
    data object BadCharacter : KeyCheck()
}

sealed class ActivateResult {
    data class Done(val key: String) : ActivateResult()
    data object Unreadable : ActivateResult()
    data object BadSignature : ActivateResult()
    data object OtherDevice : ActivateResult()
}

/**
 * Pro activation with no server and no internet, the same file format as the desktop app: the seller
 * signs a small text for one device, and the app checks it with the public key below.
 */
object Licensing {
    private const val PUBLIC_KEY = "374eee912489d5f9d40d49a28a983315cef3cbc4b6f02816e03cecd5dd02fb80"

    private fun unhex(s: String): ByteArray? {
        val t = s.trim()
        if (t.length % 2 != 0) return null
        return runCatching { ByteArray(t.length / 2) { t.substring(it * 2, it * 2 + 2).toInt(16).toByte() } }.getOrNull()
    }

    /** `JARD-DEV-7F2A-91C4-E3B8`. Android's ID for this app and device, hashed so it isn't revealed. */
    @SuppressLint("HardwareIds")
    fun deviceCode(context: Context): String {
        val id = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID).orEmpty()
        return deviceCode(id)
    }

    fun deviceCode(machineId: String): String {
        val h = MessageDigest.getInstance("SHA-256").digest("jard-device-v1:$machineId".toByteArray())
        val up = h.joinToString("") { "%02X".format(it) }
        return "JARD-DEV-${up.substring(0, 4)}-${up.substring(4, 8)}-${up.substring(8, 12)}"
    }

    fun checkKey(input: String): KeyCheck {
        val up = input.trim().uppercase()
        val body = up.removePrefix("JARD").filter { it != '-' && it != ' ' }
        if (!body.all { it in 'A'..'Z' || it in '0'..'9' }) return KeyCheck.BadCharacter
        return when {
            body.length == 12 -> KeyCheck.Ok("JARD-${body.substring(0, 4)}-${body.substring(4, 8)}-${body.substring(8, 12)}")
            body.length < 12 -> KeyCheck.Short(12 - body.length)
            else -> KeyCheck.Long(body.length - 12)
        }
    }

    fun verify(fileText: String, device: String, publicKey: String = PUBLIC_KEY): ActivateResult {
        val file = runCatching { JSONObject(fileText) }.getOrNull() ?: return ActivateResult.Unreadable
        val body = file.opt("license") as? String ?: return ActivateResult.Unreadable
        val sigText = file.opt("signature") as? String ?: return ActivateResult.Unreadable
        val pub = unhex(publicKey) ?: return ActivateResult.BadSignature
        val sig = unhex(sigText) ?: return ActivateResult.BadSignature
        if (!Ed25519.verify(pub, body.toByteArray(), sig)) return ActivateResult.BadSignature
        val license = runCatching { JSONObject(body) }.getOrNull() ?: return ActivateResult.Unreadable
        if (license.optString("device") != device) return ActivateResult.OtherDevice
        return ActivateResult.Done(license.optString("key"))
    }

    private fun file(context: Context) = File(context.filesDir, "license.json")

    /** The stored key if its file is still genuine. It's checked each time, so editing it doesn't help. */
    fun activeKey(context: Context): String? {
        val f = file(context)
        if (!f.exists()) return null
        return (verify(f.readText(), deviceCode(context)) as? ActivateResult.Done)?.key
    }

    fun activate(context: Context, fileText: String): ActivateResult {
        val r = verify(fileText, deviceCode(context))
        if (r is ActivateResult.Done) file(context).writeText(fileText)
        return r
    }

    fun deactivate(context: Context) {
        file(context).delete()
    }
}
