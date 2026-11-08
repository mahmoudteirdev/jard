package app.jard.design

// مولّد من tokens.json — لا تعدّل القيم هنا. الاسم هو ما يُستخدم في الكود لا القيمة.
// بلا Material: التصميم حواف حادة بلا ظلال ولا زوايا دائرية، فنستخدم أنظمة ألوان خاصة.

import app.jard.R
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class JardColors(
    val surfaceBase: Color, val surfaceRaised: Color, val surfaceHover: Color, val surfaceSelected: Color, val surfaceSunken: Color,
    val ink: Color, val inkQuiet: Color, val inkMuted: Color, val inkDisabled: Color,
    val accent: Color, val accentOn: Color, val line: Color, val lineStrong: Color,
    val statusGood: Color, val statusWarn: Color, val statusSerious: Color, val statusUnknown: Color,
)

val DarkColors = JardColors(
    surfaceBase = Color(0xFF101412),
    surfaceRaised = Color(0xFF171C19),
    surfaceHover = Color(0xFF1F2622),
    surfaceSelected = Color(0xFF2A332E),
    surfaceSunken = Color(0xFF0B0E0C),
    ink = Color(0xFFEDF1EC),
    inkQuiet = Color(0xFFC7D0C9),
    inkMuted = Color(0xFFA3AEA6),
    inkDisabled = Color(0xFF6E7C74),
    accent = Color(0xFFF5B83D),
    accentOn = Color(0xFF1A1405),
    line = Color(0xFF2E3732),
    lineStrong = Color(0xFF5E6B64),
    statusGood = Color(0xFF8FB6FF),
    statusWarn = Color(0xFFF5B83D),
    statusSerious = Color(0xFFFF9E6B),
    statusUnknown = Color(0xFFA3AEA6),
)

val LightColors = JardColors(
    surfaceBase = Color(0xFFF4F6F2),
    surfaceRaised = Color(0xFFFFFFFF),
    surfaceHover = Color(0xFFE6EAE4),
    surfaceSelected = Color(0xFFF3E7C8),
    surfaceSunken = Color(0xFFE6EAE4),
    ink = Color(0xFF141A16),
    inkQuiet = Color(0xFF4A5951),
    inkMuted = Color(0xFF55615A),
    inkDisabled = Color(0xFF7E8A83),
    accent = Color(0xFFF5B83D),
    accentOn = Color(0xFF1A1405),
    line = Color(0xFFD3D9D2),
    lineStrong = Color(0xFF79857E),
    statusGood = Color(0xFF2F66D0),
    statusWarn = Color(0xFF6E4A00),
    statusSerious = Color(0xFFB0431A),
    statusUnknown = Color(0xFF55615A),
)

/** ألوان البيانات: ثابتة في الوضعين. استخدمها دائماً مع اسم مكتوب بجانبها. */
object JardData {
    val d1 = Color(0xFFF5B83D)  // برامج وتطبيقات
    val d2 = Color(0xFF5B8DEF)  // فيديو
    val d3 = Color(0xFFE8743B)  // ألعاب
    val d4 = Color(0xFFC79AF0)  // صور وملفات
    val d5 = Color(0xFF4FCBA0)  // نظام وأخرى
    val pale = Color(0xFFC9D6F5)
    val grey = Color(0xFF8A958E)
}

object JardSpace { val s1 = 2.dp; val s2 = 6.dp; val s3 = 10.dp; val s4 = 16.dp; val s5 = 24.dp; val touchMin = 44.dp }
object JardRow { val simple = 44.dp; val twoLine = 48.dp; val withBar = 56.dp }
val JardShape = RectangleShape  // radius 0 في كل مكان

val JardText: FontFamily = FontFamily(
    Font(R.font.ibm_plex_sans_arabic_regular, FontWeight.Normal),
    Font(R.font.ibm_plex_sans_arabic_medium, FontWeight.Medium),
    Font(R.font.ibm_plex_sans_arabic_semibold, FontWeight.SemiBold),
    Font(R.font.ibm_plex_sans_arabic_bold, FontWeight.Bold),
)
val JardMono: FontFamily = FontFamily(
    Font(R.font.ibm_plex_mono_regular, FontWeight.Normal),
    Font(R.font.ibm_plex_mono_medium, FontWeight.Medium),
)

object JardType {
    val display = TextStyle(fontFamily = JardText, fontSize = 36.sp, fontWeight = FontWeight.Bold)
    val title = TextStyle(fontFamily = JardText, fontSize = 24.sp, fontWeight = FontWeight.Bold)
    val heading = TextStyle(fontFamily = JardText, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    val body = TextStyle(fontFamily = JardText, fontSize = 14.sp, fontWeight = FontWeight.Normal, lineHeight = 21.sp)
    val caption = TextStyle(fontFamily = JardText, fontSize = 13.sp)
    val label = TextStyle(fontFamily = JardText, fontSize = 12.sp, fontWeight = FontWeight.Medium) // الحد الأدنى: لا نص أصغر من 12
    val number = TextStyle(fontFamily = JardMono, fontSize = 14.sp)
}

val LocalJardColors = staticCompositionLocalOf { DarkColors }

@Composable
fun JardTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalJardColors provides if (dark) DarkColors else LightColors, content = content)
}

object Jard {
    val colors: JardColors @Composable get() = LocalJardColors.current
}
