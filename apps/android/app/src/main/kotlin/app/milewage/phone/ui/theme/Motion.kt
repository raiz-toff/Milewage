package app.milewage.phone.ui.theme

import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically

/**
 * Material 3 motion (m3.material.io/styles/motion): the easing and duration tokens, and the
 * transition patterns the app uses, so every screen moves the same way.
 *
 * - [sharedAxisXIn] / [sharedAxisXOut]: going deeper (a shift's detail, Permissions) and back.
 * - [fadeThroughIn] / [fadeThroughOut]: between peers that are not deeper or shallower (the bottom
 *   tabs, first run and the app, idle Home and the running shift, Today / Week / Month).
 * - [rollUp]: a figure changing to a new value.
 *
 * Android's "Remove animations" setting scales every one of these to zero; nothing here checks it.
 */
object Motion {
    val Emphasized = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val EmphasizedDecelerate = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
    val EmphasizedAccelerate = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)
    val Standard = CubicBezierEasing(0.2f, 0f, 0f, 1f)

    const val SHORT = 150
    const val MEDIUM = 300
    const val LONG = 450
}

/** How far a shared-axis slide travels: a tenth of the width (Material's 30 dp on a phone). */
private fun axisOffset(width: Int, forward: Boolean) = (width / 10) * if (forward) 1 else -1

/** The incoming screen of a shared X axis transition; [forward] is going deeper, false is going back. */
fun sharedAxisXIn(forward: Boolean): EnterTransition =
    slideInHorizontally(tween(Motion.MEDIUM, easing = Motion.EmphasizedDecelerate)) { axisOffset(it, forward) } +
        fadeIn(tween(Motion.MEDIUM * 70 / 100, delayMillis = Motion.MEDIUM * 30 / 100, easing = Motion.EmphasizedDecelerate))

/** The outgoing screen of a shared X axis transition. */
fun sharedAxisXOut(forward: Boolean): ExitTransition =
    slideOutHorizontally(tween(Motion.MEDIUM, easing = Motion.EmphasizedAccelerate)) { -axisOffset(it, forward) } +
        fadeOut(tween(Motion.MEDIUM * 30 / 100, easing = Motion.EmphasizedAccelerate))

/** The incoming content of a fade through: fades and grows from 92 % after the old content has gone. */
fun fadeThroughIn(): EnterTransition =
    fadeIn(tween(Motion.MEDIUM * 70 / 100, delayMillis = Motion.MEDIUM * 30 / 100, easing = Motion.EmphasizedDecelerate)) +
        scaleIn(tween(Motion.MEDIUM * 70 / 100, delayMillis = Motion.MEDIUM * 30 / 100, easing = Motion.EmphasizedDecelerate), initialScale = 0.92f)

/** The outgoing content of a fade through. */
fun fadeThroughOut(): ExitTransition = fadeOut(tween(Motion.MEDIUM * 30 / 100, easing = Motion.EmphasizedAccelerate))

/** A fade through for `AnimatedContent`, sized without clipping. */
fun fadeThrough(): ContentTransform =
    ContentTransform(targetContentEnter = fadeThroughIn(), initialContentExit = fadeThroughOut(), sizeTransform = SizeTransform(clip = false))

/** A figure rolling to a new value: the new one rises in from below as the old one rises away. */
fun rollUp(): ContentTransform = ContentTransform(
    targetContentEnter = slideInVertically(tween(Motion.MEDIUM, easing = Motion.EmphasizedDecelerate)) { it / 2 } +
        fadeIn(tween(Motion.SHORT, easing = Motion.Standard)),
    initialContentExit = slideOutVertically(tween(Motion.SHORT, easing = Motion.EmphasizedAccelerate)) { -it / 2 } +
        fadeOut(tween(Motion.SHORT, easing = Motion.Standard)),
    sizeTransform = SizeTransform(clip = false),
)
