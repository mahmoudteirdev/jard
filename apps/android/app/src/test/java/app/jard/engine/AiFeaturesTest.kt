package app.jard.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiFeaturesTest {

    @Test
    fun testArabicVideoQuery() {
        val now = 1700000000000L
        val res = AiQuery.parse("الفيديوهات الأكبر من 500 ميغا في التنزيلات", now)
        assertEquals("video", res.targetKind)
        assertEquals(500L * 1024L * 1024L, res.minSize)
        assertEquals("Download", res.targetFolder)
        assertTrue(res.explanationAr.contains("مقاطع الفيديو"))
        assertTrue(res.explanationAr.contains("500"))
    }

    @Test
    fun testStaleDocumentsQuery() {
        val now = 1700000000000L
        val res = AiQuery.parse("المستندات القديمة المهجورة من 6 شهور", now)
        assertEquals("document", res.targetKind)
        assertNotNull(res.olderThanMs)
        assertEquals(now - (180L * 86_400_000L), res.olderThanMs)
        assertTrue(res.explanationAr.contains("المستندات"))
    }

    @Test
    fun testEmptyFoldersQuery() {
        val res = AiQuery.parse("المجلدات الفارغة", 1700000000000L)
        assertTrue(res.emptyFolders)
        assertEquals("find_empty_folders", res.recognizedIntent)
    }

    @Test
    fun testEnglishQuery() {
        val now = 1700000000000L
        val res = AiQuery.parse("videos larger than 1gb in download", now)
        assertEquals("video", res.targetKind)
        assertEquals(1024L * 1024L * 1024L, res.minSize)
        assertEquals("Download", res.targetFolder)
        assertTrue(res.explanationEn.contains("videos"))
    }

    @Test
    fun testArabicNormalization() {
        val norm = AiQuery.normalizeArabic("أَحْمَدُ فِي الْمَدِينَةِ")
        assertEquals("احمد في المدينه", norm)
    }
}
