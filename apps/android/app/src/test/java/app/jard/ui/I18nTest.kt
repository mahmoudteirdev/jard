package app.jard.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class I18nTest {
    private val dict = """{"جيدة":"Good","{} دورة":"{} cycles","{} · {}":"{} · {}","انتقل {} إلى الحجر":"{} moved to quarantine","{}: {}":"{}: {}","سليم":"OK","السماعة":"Speaker"}"""

    @Test
    fun whole_sentences_and_filled_in_parts_both_translate() {
        I18n.useEnglishForTest(dict)
        assertEquals("Good", I18n.tr("جيدة"))
        assertEquals("3 moved to quarantine", I18n.tr("انتقل 3 إلى الحجر"))
        assertEquals("Good · 10 cycles", I18n.tr("جيدة · 10 دورة"))
        assertEquals("Speaker: OK", I18n.tr("السماعة: سليم"))
    }

    @Test
    fun names_and_unknown_text_pass_through() {
        I18n.useEnglishForTest(dict)
        assertEquals("report.pdf", I18n.tr("report.pdf"))
        assertEquals("نص ما له ترجمة", I18n.tr("نص ما له ترجمة"))
    }
}
