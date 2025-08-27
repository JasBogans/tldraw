import { useEffect } from 'react'
import type { Editor } from '../editor/Editor'
import type { TLPinchEventInfo, TLWheelEventInfo } from '../editor/types/event-types'
import { Vec } from '../primitives/Vec'
import { preventDefault, stopEventPropagation } from '../utils/dom'
import { isAccelKey } from '../utils/keyboard'
import { normalizeWheel } from '../utils/normalizeWheel'

type DomDeps = {
	editor: Editor
	container: HTMLElement | null
}

/**
 * Custom hook that replaces @use-gesture/react with native DOM event handling.
 * IMPORTANT: This hook only handles wheel and pinch gestures.
 * Pointer and keyboard events are already handled by useCanvasEvents/useDocumentEvents.
 */
export function useDomCanvasEvents({ editor, container }: DomDeps) {
	useEffect(() => {
		if (!container) return

		// Ensure browser/WebView doesn't hijack gestures
		container.style.touchAction = 'none'
		;(container.style as any).webkitUserSelect = 'none'

		// Track active pointers for multi-touch gestures (pinch)
		const activePointers = new Map<number, PointerEvent>()

		// Pinch gesture state tracking
		let pinchState: 'not sure' | 'zooming' | 'panning' = 'not sure'
		let initDistanceBetweenFingers = 1
		let initZoom = 1
		let currDistanceBetweenFingers = 0
		const initPointBetweenFingers = new Vec()
		const prevPointBetweenFingers = new Vec()

		// Calculate distance between two pointers
		const getPointerDistance = (p1: PointerEvent, p2: PointerEvent) => {
			const dx = p1.clientX - p2.clientX
			const dy = p1.clientY - p2.clientY
			return Math.sqrt(dx * dx + dy * dy)
		}

		// Calculate center point between two pointers
		const getPointerCenter = (p1: PointerEvent, p2: PointerEvent) => {
			return {
				x: (p1.clientX + p2.clientX) / 2,
				y: (p1.clientY + p2.clientY) / 2,
			}
		}

		// Update pinch state based on gesture analysis
		const updatePinchState = () => {
			if (pinchState === 'zooming') return

			const touchDistance = Math.abs(currDistanceBetweenFingers - initDistanceBetweenFingers)
			const originDistance = Vec.Dist(initPointBetweenFingers, prevPointBetweenFingers)

			switch (pinchState) {
				case 'not sure': {
					if (touchDistance > 24) {
						pinchState = 'zooming'
					} else if (originDistance > 16) {
						pinchState = 'panning'
					}
					break
				}
				case 'panning': {
					if (touchDistance > 64) {
						pinchState = 'zooming'
					}
					break
				}
			}
		}

		// POINTER EVENTS (only used to synthesize pinch) ----------------------------------------
		const onPointerDown = (e: PointerEvent) => {
			activePointers.set(e.pointerId, e)

			if (activePointers.size === 2) {
				const [p1, p2] = Array.from(activePointers.values())
				const center = getPointerCenter(p1, p2)

				pinchState = 'not sure'
				prevPointBetweenFingers.x = center.x
				prevPointBetweenFingers.y = center.y
				initPointBetweenFingers.x = center.x
				initPointBetweenFingers.y = center.y
				initDistanceBetweenFingers = getPointerDistance(p1, p2)
				initZoom = editor.getZoomLevel()

				const pinchInfo: TLPinchEventInfo = {
					type: 'pinch',
					name: 'pinch_start',
					point: { x: center.x, y: center.y, z: editor.getZoomLevel() },
					delta: { x: 0, y: 0 },
					shiftKey: e.shiftKey,
					altKey: e.altKey,
					ctrlKey: e.metaKey || e.ctrlKey,
					metaKey: e.metaKey,
					accelKey: isAccelKey(e),
				}
				editor.dispatch(pinchInfo)
			}
		}

		const onPointerMove = (e: PointerEvent) => {
			if (!activePointers.has(e.pointerId)) return
			activePointers.set(e.pointerId, e)

			if (activePointers.size === 2) {
				const [p1, p2] = Array.from(activePointers.values())
				const center = getPointerCenter(p1, p2)
				currDistanceBetweenFingers = getPointerDistance(p1, p2)

				const dx = center.x - prevPointBetweenFingers.x
				const dy = center.y - prevPointBetweenFingers.y

				prevPointBetweenFingers.x = center.x
				prevPointBetweenFingers.y = center.y

				updatePinchState()

				switch (pinchState) {
					case 'zooming': {
						const scale = currDistanceBetweenFingers / initDistanceBetweenFingers
						const currZoom = initZoom * scale ** editor.getCameraOptions().zoomSpeed

						const pinchInfo: TLPinchEventInfo = {
							type: 'pinch',
							name: 'pinch',
							point: { x: center.x, y: center.y, z: currZoom },
							delta: { x: dx, y: dy },
							shiftKey: e.shiftKey,
							altKey: e.altKey,
							ctrlKey: e.metaKey || e.ctrlKey,
							metaKey: e.metaKey,
							accelKey: isAccelKey(e),
						}
						editor.dispatch(pinchInfo)
						break
					}
					case 'panning': {
						const pinchInfo: TLPinchEventInfo = {
							type: 'pinch',
							name: 'pinch',
							point: { x: center.x, y: center.y, z: initZoom },
							delta: { x: dx, y: dy },
							shiftKey: e.shiftKey,
							altKey: e.altKey,
							ctrlKey: e.metaKey || e.ctrlKey,
							metaKey: e.metaKey,
							accelKey: isAccelKey(e),
						}
						editor.dispatch(pinchInfo)
						break
					}
				}
			}
		}

		const onPointerUp = (e: PointerEvent) => {
			// If we were pinching and one finger lifts, dispatch pinch_end
			if (activePointers.size === 2) {
				const scale = currDistanceBetweenFingers / initDistanceBetweenFingers
				const finalZoom = initZoom * scale ** editor.getCameraOptions().zoomSpeed

				pinchState = 'not sure'

				editor.timers.requestAnimationFrame(() => {
					const pinchInfo: TLPinchEventInfo = {
						type: 'pinch',
						name: 'pinch_end',
						point: { x: prevPointBetweenFingers.x, y: prevPointBetweenFingers.y, z: finalZoom },
						delta: { x: prevPointBetweenFingers.x, y: prevPointBetweenFingers.y },
						shiftKey: e.shiftKey,
						altKey: e.altKey,
						ctrlKey: e.metaKey || e.ctrlKey,
						metaKey: e.metaKey,
						accelKey: isAccelKey(e),
					}
					editor.dispatch(pinchInfo)
				})
			}

			activePointers.delete(e.pointerId)
		}

		// WHEEL EVENT --------------------------------------------------------------------------
		const onWheel = (e: WheelEvent) => {
			if (!editor.getInstanceState().isFocused) return

			pinchState = 'not sure'

			// Allow scrolling inside scrollable editing shapes
			const editingShapeId = editor.getEditingShapeId()
			if (editingShapeId) {
				const shape = editor.getShape(editingShapeId)
				if (shape) {
					const util = editor.getShapeUtil(shape)
					if (util.canScroll(shape)) {
						const bounds = editor.getShapePageBounds(editingShapeId)
						if (bounds?.containsPoint(editor.inputs.currentPagePoint)) {
							return
						}
					}
				}
			}

			preventDefault(e)
			stopEventPropagation(e)
			const delta = normalizeWheel(e)
			if (delta.x === 0 && delta.y === 0) return

			const info: TLWheelEventInfo = {
				type: 'wheel',
				name: 'wheel',
				delta,
				point: new Vec(e.clientX, e.clientY),
				shiftKey: e.shiftKey,
				altKey: e.altKey,
				ctrlKey: e.metaKey || e.ctrlKey,
				metaKey: e.metaKey,
				accelKey: isAccelKey(e),
			}

			editor.dispatch(info)
		}

		// Attach event listeners (note: pointer handlers only for pinch synthesis)
		container.addEventListener('pointerdown', onPointerDown, { passive: false })
		container.addEventListener('pointermove', onPointerMove, { passive: false })
		container.addEventListener('pointerup', onPointerUp, { passive: false })
		container.addEventListener('pointercancel', onPointerUp, { passive: false })
		container.addEventListener('wheel', onWheel, { passive: false })

		return () => {
			container.removeEventListener('pointerdown', onPointerDown)
			container.removeEventListener('pointermove', onPointerMove)
			container.removeEventListener('pointerup', onPointerUp)
			container.removeEventListener('pointercancel', onPointerUp)
			container.removeEventListener('wheel', onWheel)
		}
	}, [editor, container])
}
