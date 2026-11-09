package app.jard.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream

class EngineTest {
    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    /** RFC 8032, section 7.1. */
    @Test
    fun ed25519_matches_the_rfc_vectors() {
        val pub1 = hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        val sig1 = hex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
        assertTrue(Ed25519.verify(pub1, ByteArray(0), sig1))
        val pub2 = hex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c")
        val sig2 = hex("92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00")
        assertTrue(Ed25519.verify(pub2, hex("72"), sig2))
        assertFalse("another message", Ed25519.verify(pub2, hex("73"), sig2))
        assertFalse("another key", Ed25519.verify(pub1, hex("72"), sig2))
        sig2[10] = (sig2[10] + 1).toByte()
        assertFalse("a changed signature", Ed25519.verify(pub2, hex("72"), sig2))
    }

    @Test
    fun typed_keys_say_what_is_wrong() {
        assertEquals(KeyCheck.Ok("JARD-AB12-CD34-EF56"), Licensing.checkKey(" jard ab12 cd34 ef56 "))
        assertEquals(KeyCheck.Short(4), Licensing.checkKey("JARD-AB12-CD34"))
        assertEquals(KeyCheck.Long(1), Licensing.checkKey("JARD-AB12-CD34-EF56-7"))
        assertEquals(KeyCheck.BadCharacter, Licensing.checkKey("JARD-AB12-CD34-EF5!"))
    }

    @Test
    fun device_code_is_stable_and_hides_the_id() {
        val a = Licensing.deviceCode("secret-id")
        assertEquals(a, Licensing.deviceCode("secret-id"))
        assertNotEquals(a, Licensing.deviceCode("another"))
        assertTrue(a.startsWith("JARD-DEV-") && a.length == 23 && "secret" !in a)
    }

    private fun tree(): ScanTree {
        val nodes = ArrayList<FileNode>()
        nodes.add(FileNode(0, "/s", -1, true, "/s"))
        nodes.add(FileNode(1, "a", 0, true, "/s/a", partial = true))
        nodes.add(FileNode(2, "f.bin", 1, false, "/s/a/f.bin", apparent = 10, onDisk = 4096, modified = 99, files = 1))
        nodes.add(FileNode(3, "gone.bin", 0, false, "/s/gone.bin", apparent = 5, onDisk = 4096, files = 1))
        nodes[0].children.addAll(listOf(1, 3))
        nodes[1].children.add(2)
        return ScanTree(nodes, "/s", false, ScanTree.Scope.AllFiles).also { it.rollUp() }
    }

    @Test
    fun a_saved_scan_comes_back_the_same_and_keeps_what_left() {
        val t = tree()
        t.detach(3)
        val bytes = ByteArrayOutputStream().also { SavedScans.write(t, 1234, DataOutputStream(it)) }.toByteArray()
        val (back, at) = SavedScans.read(DataInputStream(ByteArrayInputStream(bytes)))!!
        assertEquals(1234, at)
        assertEquals(t.root.onDisk, back.root.onDisk)
        assertEquals(listOf(1), back.root.children.toList())
        assertEquals("/s/a/f.bin", back.nodes[2].location)
        assertTrue(back.nodes[1].partial)
        assertEquals(99, back.nodes[2].modified)
    }

    @Test
    fun du_output_is_read_largest_first() {
        val rows = Privileged.parseDu("4\t/a\n100\t/b c\nnonsense\n\n")
        assertEquals(listOf("/b c" to 102400L, "/a" to 4096L), rows)
    }

    @Test
    fun a_formula_can_not_ride_in_on_a_device_name() {
        assertEquals("\"'=cmd\"", ShopLog.csvCell("=cmd"))
        assertEquals("\"a\"\"b\"", ShopLog.csvCell("a\"b"))
    }

    @Test
    fun finding_bytes_in_a_package() {
        assertTrue(Security.contains("xxLcom/appsflyer/yy".toByteArray(), "Lcom/appsflyer/".toByteArray()))
        assertFalse(Security.contains("Lcom/appsflye".toByteArray(), "Lcom/appsflyer/".toByteArray()))
    }

    @Test
    fun ages_use_the_arabic_forms() {
        val now = 1_000_000_000L
        assertEquals("اليوم", agoText(now - 100, now))
        assertEquals("قبل يومين", agoText(now - 2 * 86_400, now))
        assertEquals("قبل 5 أيام", agoText(now - 5 * 86_400, now))
        assertEquals("قبل 11 يوماً", agoText(now - 11 * 86_400, now))
        assertEquals("قبل شهرين", agoText(now - 60 * 86_400, now))
    }

    @Test
    fun explanations_admit_what_they_do_not_know() {
        val odd = FileNode(5, "qwerty.xyz", 0, false, "/s/qwerty.xyz")
        assertEquals(Safety.Unknown, Explain.of(odd).safety)
        assertEquals(Safety.Safe, Explain.of(FileNode(6, ".thumbnails", 0, true, "/s/.thumbnails")).safety)
        assertEquals(Safety.Keep, Explain.of(FileNode(7, "DCIM", 0, true, "/s/DCIM")).safety)
    }

    /** A file really issued by the seller tool (jard-license), with a throwaway key. */
    @Test
    fun a_file_from_the_seller_tool_passes_here_too() {
        val file = "{\n  \"license\": \"{\\\"device\\\":\\\"JARD-DEV-AAAA-BBBB-CCCC\\\",\\\"key\\\":\\\"JARD-AB12-CD34-EF56\\\",\\\"name\\\":\\\"محل الاختبار\\\",\\\"issued\\\":1794184691}\",\n  \"signature\": \"9dcca25fa815d2cfeed806593cad1f5c90c7154c0feaf586f8135bfbf5fab1b652605eaf7ed0a25139fd784c0fb19a18d9a9d52ae494d0ad3b46d9fd4b217508\"\n}"
        val pub = "3051111ae050fa3e97f37c639e87e87674524bd1ae5949ae719b0b848d5b2714"
        assertEquals(ActivateResult.Done("JARD-AB12-CD34-EF56"), Licensing.verify(file, "JARD-DEV-AAAA-BBBB-CCCC", pub))
        assertEquals(ActivateResult.OtherDevice, Licensing.verify(file, "JARD-DEV-0000-0000-0000", pub))
        assertEquals(ActivateResult.BadSignature, Licensing.verify(file.replace("AB12", "ZZ12"), "JARD-DEV-AAAA-BBBB-CCCC", pub))
        assertEquals(ActivateResult.BadSignature, Licensing.verify(file, "JARD-DEV-AAAA-BBBB-CCCC"))
        assertEquals(ActivateResult.Unreadable, Licensing.verify("hello", "JARD-DEV-AAAA-BBBB-CCCC", pub))
    }
}
