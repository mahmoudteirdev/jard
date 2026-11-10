package app.jard.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.foundation.Image
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import app.jard.design.Jard
import app.jard.design.JardData
import app.jard.design.JardTheme
import app.jard.design.JardType

class MainActivity : ComponentActivity() {
    private lateinit var state: AppState
    /** Coming back from system settings: permissions may have changed. */
    private val resumed = mutableIntStateOf(0)

    private companion object {
        var shared: AppState? = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        state = shared ?: AppState(applicationContext).also {
            shared = it
            Thread { it.store.purgeExpired() }.start()
        }
        setContent {
            val s = remember { state }
            val dark = s.dark ?: isSystemInDarkTheme()
            // The bars follow the app's theme, which the user may have set against the system's.
            DisposableEffect(dark) {
                val clear = android.graphics.Color.TRANSPARENT
                val style = if (dark) SystemBarStyle.dark(clear) else SystemBarStyle.light(clear, clear)
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                onDispose {}
            }
            JardTheme(dark = dark) {
                CompositionLocalProvider(LocalLayoutDirection provides if (I18n.english) LayoutDirection.Ltr else LayoutDirection.Rtl) {
                    Root(s, resumed.intValue)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        resumed.intValue++
        if (::state.isInitialized) {
            state.refreshStorage()
            state.refreshApps()
        }
    }
}

private val NAV = listOf(
    Triple(Tab.Home, "الرئيسية", "M12 3 3 11h3v10h5v-6h2v6h5V11h3z"),
    Triple(Tab.Files, "الملفات", "M5 2h9l5 5v15H5zM8 11v2h8v-2zM8 15v2h8v-2z"),
    Triple(Tab.Apps, "التطبيقات", "M12 2.5 20 7l-8 4.5L4 7zM3.5 8.5l7.75 4.4v8.6L3.5 17zM20.5 8.5l-7.75 4.4v8.6l7.75-4.5z"),
    Triple(Tab.Check, "الفحص", "M12 2l8 3v6c0 5.2-3.4 9.2-8 11-4.6-1.8-8-5.8-8-11V5zM10.6 15.6l6-6-1.4-1.4-4.6 4.6-2-2-1.4 1.4z"),
    Triple(Tab.More, "المزيد", "M5 10h4v4H5zM10 10h4v4h-4zM15 10h4v4h-4z"),
)

@Composable
fun PathIcon(d: String, color: Color, size: Int = 20) {
    val vector = remember(d, color) {
        ImageVector.Builder(defaultWidth = size.dp, defaultHeight = size.dp, viewportWidth = 24f, viewportHeight = 24f)
            .addPath(addPathNodes(d), fill = SolidColor(color))
            .build()
    }
    Image(rememberVectorPainter(vector), contentDescription = null, Modifier.size(size.dp))
}

@Composable
fun BrandLogo() {
    Column(
        Modifier
            .size(36.dp)
            .padding(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(Modifier.size(width = 24.dp, height = 5.dp).background(JardData.d1))
        Box(Modifier.size(width = 17.dp, height = 5.dp).background(JardData.d2))
        Box(Modifier.size(width = 10.dp, height = 5.dp).background(JardData.d3))
    }
}

@Composable
private fun Root(s: AppState, resumed: Int) {
    BackHandler(enabled = s.page != Page.None || s.tab != Tab.Home) {
        if (s.page != Page.None) s.goBack() else s.tab = Tab.Home
    }
    LaunchedEffect(Unit) { if (!s.onboarded && !s.guest && s.page == Page.None) s.page = Page.Onboard }

    val config = LocalConfiguration.current
    val isTablet = config.screenWidthDp >= 600

    // These show a colour or a test across the whole screen, with nothing around it.
    val bare = s.page == Page.Scan || s.page == Page.Onboard || s.page == Page.Pixels || s.page == Page.Test

    if (isTablet) {
        Row(Modifier.fillMaxSize().background(Jard.colors.surfaceBase).safeDrawingPadding()) {
            if (!bare) {
                Column(
                    Modifier
                        .width(96.dp)
                        .fillMaxHeight()
                        .background(Jard.colors.surfaceRaised)
                        .padding(vertical = 16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    BrandLogo()
                    Spacer(Modifier.height(16.dp))
                    for ((tab, name, d) in NAV) {
                        val on = s.page == Page.None && s.tab == tab
                        val color = if (on) Jard.colors.statusWarn else Jard.colors.ink
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .height(64.dp)
                                .semantics { selected = on }
                                .clickable(role = Role.Tab) {
                                    s.page = Page.None
                                    s.tab = tab
                                },
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            PathIcon(d, color, size = 22)
                            Spacer(Modifier.height(4.dp))
                            T(name, style = JardType.label, color = color, weight = if (on) FontWeight.Bold else FontWeight.Medium)
                        }
                        Spacer(Modifier.height(6.dp))
                    }
                }
                Box(Modifier.width(1.dp).fillMaxHeight().background(Jard.colors.line))
            }
            Box(Modifier.weight(1f).fillMaxHeight()) {
                ScreenContent(s, resumed, isTablet = true)
            }
        }
    } else {
        Column(Modifier.fillMaxSize().background(Jard.colors.surfaceBase).safeDrawingPadding()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                ScreenContent(s, resumed, isTablet = false)
            }
            if (!bare) {
                Row(Modifier.fillMaxWidth().height(68.dp).background(Jard.colors.surfaceRaised)) {
                    for ((tab, name, d) in NAV) {
                        val on = s.page == Page.None && s.tab == tab
                        val color = if (on) Jard.colors.statusWarn else Jard.colors.ink
                        Column(
                            Modifier.weight(1f).height(68.dp)
                                .semantics { selected = on }
                                .clickable(role = Role.Tab) {
                                    s.page = Page.None
                                    s.tab = tab
                                },
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            PathIcon(d, color)
                            T(name, style = JardType.label, color = color, weight = if (on) FontWeight.Bold else FontWeight.Medium)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ScreenContent(s: AppState, resumed: Int, isTablet: Boolean) {
    if (isTablet && s.page == Page.Explain && s.explaining != null) {
        Row(Modifier.fillMaxSize()) {
            Box(Modifier.weight(0.55f).fillMaxHeight()) {
                FilesScreen(s)
            }
            Box(Modifier.width(1.dp).fillMaxHeight().background(Jard.colors.line))
            Box(Modifier.weight(0.45f).fillMaxHeight()) {
                ExplainScreen(s)
            }
        }
        return
    }

    when (s.page) {
        Page.Onboard -> OnboardScreen(s, resumed)
        Page.Permission -> PermissionScreen(s, resumed)
        Page.Scan -> ScanScreen(s)
        Page.ScanLost -> ScanLostScreen(s, resumed)
        Page.Result -> ResultScreen(s)
        Page.History -> HistoryScreen(s)
        Page.Settings -> SettingsScreen(s)
        Page.About -> AboutScreen(s)
        Page.Clean -> CleanScreen(s)
        Page.Explain -> ExplainScreen(s)
        Page.Slow -> SlowScreen(s)
        Page.Device -> DeviceScreen(s)
        Page.Battery -> BatteryScreen(s)
        Page.Bench -> BenchScreen(s)
        Page.Pixels -> PixelsScreen(s)
        Page.Used -> UsedScreen(s)
        Page.Security -> SecurityScreen(s)
        Page.Network -> NetworkScreen(s, resumed)
        Page.Compare -> CompareScreen(s)
        Page.Widgets -> WidgetsScreen(s)
        Page.Access -> AccessScreen(s, resumed)
        Page.Root -> RootScreen(s)
        Page.Expert -> ExpertScreen(s)
        Page.Pro -> ProScreen(s)
        Page.Key -> KeyScreen(s)
        Page.Guest -> GuestScreen(s)
        Page.ShopLog -> ShopLogScreen(s)
        Page.ShopReport -> ShopReportScreen(s)
        Page.ShopSetup -> ShopSetupScreen(s)
        Page.ShopCompare -> ShopCompareScreen(s)
        Page.Test -> ManualTestScreen(s)
        Page.StorageHealth -> StorageHealthScreen(s)
        Page.GhostFiles -> GhostFilesScreen(s)
        Page.AiQuery -> AiQueryScreen(s)
        Page.PredictiveStorage -> PredictiveStorageScreen(s)
        Page.None -> when (s.tab) {
            Tab.Home -> if (s.simple) SimpleHome(s) else HomeScreen(s, resumed)
            Tab.Files -> FilesScreen(s)
            Tab.Apps -> AppsScreen(s, resumed)
            Tab.Check -> CheckScreen(s)
            Tab.More -> MoreScreen(s)
        }
    }
}
