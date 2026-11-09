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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
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
import app.jard.engine.RowTag

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
        I18n.tr(text),
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
            .semantics { contentDescription = I18n.tr(label) },
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

/** A page's title with its way back. The arrow follows the reading direction. */
@Composable
fun Head(s: AppState, title: String, note: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(
            Modifier.size(JardSpace.touchMin).clickable(role = Role.Button, onClickLabel = I18n.tr("رجوع")) { s.goBack() }
                .semantics { contentDescription = I18n.tr("رجوع") },
            contentAlignment = Alignment.Center,
        ) {
            PathIcon("M9 4l8 8-8 8-2-2 6-6-6-6z", Jard.colors.ink)
        }
        Title(title)
    }
    if (note != null) Muted(note)
}

@Composable
fun FactRow(k: String, v: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Muted(k, Modifier.weight(1f))
        Value(v)
    }
}

/** A reading: numbers and codes in mono, words in the text face. */
@Composable
fun Value(text: String, modifier: Modifier = Modifier) {
    val shown = I18n.tr(text)
    if (I18n.hasArabic(shown)) T(shown, modifier, color = Jard.colors.ink) else Num(shown, modifier)
}

@Composable
fun Tabs(items: List<Pair<String, String>>, current: String, onPick: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((id, name) in items) {
            val on = id == current
            Box(
                Modifier.weight(1f).heightIn(min = JardSpace.touchMin)
                    .background(if (on) Jard.colors.surfaceSelected else Color.Transparent)
                    .border(BorderStroke(1.dp, if (on) Jard.colors.accent else Jard.colors.line))
                    .semantics { selected = on }
                    .clickable(role = Role.Tab) { onPick(id) }
                    .padding(horizontal = 4.dp, vertical = 6.dp),
                contentAlignment = Alignment.Center,
            ) { T(name, weight = if (on) FontWeight.SemiBold else FontWeight.Normal, align = TextAlign.Center) }
        }
    }
}

/** One line that opens something. */
@Composable
fun LinkRow(name: String, note: String? = null, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().heightIn(min = JardSpace.touchMin).clickable(role = Role.Button, onClick = onClick).padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
    ) {
        T(name, weight = FontWeight.Medium)
        if (note != null) Muted(note)
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(Jard.colors.line))
}

@Composable
fun Toggle(on: Boolean, label: String, note: String? = null, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    CheckRow(on, onChange, I18n.tr(label), enabled = enabled) {
        Column(Modifier.weight(1f)) {
            T(label, color = if (enabled) Jard.colors.ink else Jard.colors.inkDisabled)
            if (note != null) Muted(note)
        }
    }
}

/** A text field: label above, what went wrong below. */
@Composable
fun Field(value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, error: String? = null, mono: Boolean = false, minLines: Int = 1) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Muted(label)
        BasicTextField(
            value,
            onChange,
            Modifier.fillMaxWidth().heightIn(min = JardSpace.touchMin)
                .background(Jard.colors.surfaceBase)
                .border(BorderStroke(1.dp, if (error != null) Jard.colors.statusSerious else Jard.colors.lineStrong))
                .padding(10.dp)
                .semantics { contentDescription = I18n.tr(label) },
            textStyle = (if (mono) JardType.number else JardType.body).copy(color = Jard.colors.ink),
            cursorBrush = SolidColor(Jard.colors.accent),
            minLines = minLines,
        )
        if (error != null) T(error, style = JardType.caption, color = Jard.colors.statusSerious)
    }
}

/** A word beside a value, never colour alone. */
@Composable
fun TagWord(tag: RowTag) {
    if (tag.word.isEmpty()) return
    val color = when (tag) {
        RowTag.Good -> Jard.colors.statusGood
        RowTag.Warn -> Jard.colors.statusWarn
        RowTag.Bad -> Jard.colors.statusSerious
        else -> Jard.colors.inkMuted
    }
    T(tag.word, style = JardType.label, color = color)
}
