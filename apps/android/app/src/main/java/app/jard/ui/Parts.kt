package app.jard.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jard.design.Jard
import app.jard.design.JardMono
import app.jard.design.JardSpace
import app.jard.design.JardType

@Composable
fun T(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = JardType.body,
    color: Color = Jard.colors.ink,
    weight: FontWeight? = null,
    align: TextAlign? = null,
) {
    BasicText(
        text,
        modifier,
        style = style.copy(color = color, fontWeight = weight ?: style.fontWeight, textAlign = align ?: TextAlign.Unspecified),
    )
}

/** Keeps a size or a path in order inside an Arabic sentence: "3.15 MB", not "MB 3.15". */
fun ltr(text: String) = "⁦$text⁩"

/** Numbers and paths: left-to-right and monospaced, even inside Arabic. */
@Composable
fun Num(text: String, modifier: Modifier = Modifier, size: Int = 13, color: Color = Jard.colors.ink) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        BasicText(text, modifier, style = TextStyle(fontFamily = JardMono, fontSize = size.sp, color = color))
    }
}

@Composable
fun Title(text: String) {
    T(text, Modifier.semantics { heading() }, JardType.title.copy(fontSize = 22.sp))
}

@Composable
fun Muted(text: String, modifier: Modifier = Modifier) {
    T(text, modifier, JardType.caption, Jard.colors.inkMuted)
}

enum class BtnKind { Primary, Secondary, Danger }

@Composable
fun Btn(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: BtnKind = BtnKind.Secondary,
    enabled: Boolean = true,
    minHeight: Dp = JardSpace.touchMin,
) {
    val c = Jard.colors
    val bg = if (kind == BtnKind.Primary && enabled) c.accent else Color.Transparent
    val fg = when {
        !enabled -> c.inkDisabled
        kind == BtnKind.Primary -> c.accentOn
        kind == BtnKind.Danger -> c.statusSerious
        else -> c.ink
    }
    val line = when {
        kind == BtnKind.Primary && enabled -> c.accent
        !enabled -> c.line
        kind == BtnKind.Danger -> c.statusSerious
        else -> c.lineStrong
    }
    Box(
        modifier
            .heightIn(min = minHeight)
            .background(bg)
            .border(BorderStroke(1.dp, line))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        T(text, style = JardType.body, color = fg, weight = if (kind == BtnKind.Primary) FontWeight.Bold else FontWeight.Medium, align = TextAlign.Center)
    }
}

@Composable
fun Card(modifier: Modifier = Modifier, borderColor: Color = Jard.colors.line, content: @Composable () -> Unit) {
    Column(
        modifier.fillMaxWidth().background(Jard.colors.surfaceRaised).border(BorderStroke(1.dp, borderColor)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) { content() }
}

/** The whole row toggles, and is at least 44dp tall. */
@Composable
fun CheckRow(checked: Boolean, onChange: (Boolean) -> Unit, label: String, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = JardSpace.touchMin)
            .toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onChange)
            .semantics { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier.size(20.dp)
                .border(BorderStroke(1.dp, if (enabled) Jard.colors.lineStrong else Jard.colors.line))
                .background(if (checked) Jard.colors.accent else Color.Transparent),
            contentAlignment = Alignment.Center,
        ) {
            if (checked) T("✓", style = JardType.label, color = Jard.colors.accentOn, weight = FontWeight.Bold)
        }
        content()
    }
}

/** A share of a whole. Always next to its name and size: never colour alone. */
@Composable
fun ShareBar(fraction: Float, color: Color, modifier: Modifier = Modifier, height: Dp = 3.dp) {
    Box(modifier.fillMaxWidth().height(height).background(Jard.colors.line)) {
        Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(height).background(color))
    }
}

@Composable
fun Note(text: String, color: Color = Jard.colors.statusGood, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().background(Jard.colors.surfaceRaised).border(BorderStroke(1.dp, color)).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        T(text, Modifier.weight(1f))
        if (action != null && onAction != null) Btn(action, onAction)
    }
}

@Composable
fun Swatch(color: Color) {
    Box(Modifier.size(10.dp).background(color))
}

@Composable
fun Spacer4() {
    Box(Modifier.width(4.dp).defaultMinSize(minHeight = 1.dp))
}
