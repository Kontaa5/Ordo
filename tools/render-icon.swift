import CoreGraphics
import ImageIO
import Foundation
import UniformTypeIdentifiers

// Renders the "Mono" Ordo icon. Geometry in a 100×100 design space (y down).
struct Palette { var bg: CGColor?; var fg: CGColor; var dot: CGColor }

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: a)
}

func squircle(_ r: CGRect, _ radius: CGFloat) -> CGPath {
    CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

/// - mac: 824 pt rounded tile centred on a transparent 1024 canvas with a soft shadow.
/// - ios: full-bleed square, the system applies the mask.
func render(_ p: Palette, mac: Bool, to path: String) {
    let size = 1024
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.translateBy(x: 0, y: CGFloat(size)); ctx.scaleBy(x: 1, y: -1)   // y down like SVG
    let tile = mac ? CGRect(x: 100, y: 100, width: 824, height: 824) : CGRect(x: 0, y: 0, width: 1024, height: 1024)
    if let bg = p.bg {
        ctx.saveGState()
        if mac { ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: rgb(0x000000, 0.35)) }
        ctx.addPath(mac ? squircle(tile, 185) : CGPath(rect: tile, transform: nil))
        ctx.setFillColor(bg); ctx.fillPath()
        ctx.restoreGState()
    }
    let s = tile.width / 100
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: tile.minX + x * s, y: tile.minY + y * s) }
    ctx.setStrokeColor(p.fg); ctx.setLineWidth(5.5 * s); ctx.setLineCap(.round)
    for (a, b) in [((44, 26), (38, 74)), ((62, 26), (56, 74)), ((28, 41), (72, 41)), ((26, 59), (70, 59))] as [((CGFloat, CGFloat), (CGFloat, CGFloat))] {
        ctx.move(to: pt(a.0, a.1)); ctx.addLine(to: pt(b.0, b.1))
    }
    ctx.strokePath()
    let c = pt(74, 26), r = 6 * s
    ctx.setFillColor(p.dot); ctx.fillEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))

    let img = ctx.makeImage()!
    let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, img, nil)
    CGImageDestinationFinalize(dest)
}

// Usage: swift tools/render-icon.swift <output-dir>  (then copy into Ordo/Assets.xcassets)
let out = CommandLine.arguments[1]
let light = Palette(bg: rgb(0xFAFAFA), fg: rgb(0x111113), dot: rgb(0x7C5CF0))
let dark = Palette(bg: rgb(0x101012), fg: rgb(0xF4F4F5), dot: rgb(0x9B82FA))
render(light, mac: false, to: "\(out)/ios-light.png")
render(Palette(bg: nil, fg: rgb(0xF4F4F5), dot: rgb(0x9B82FA)), mac: false, to: "\(out)/ios-dark.png")      // system draws the dark backdrop
render(Palette(bg: rgb(0x000000), fg: rgb(0xFFFFFF), dot: rgb(0xBDBDBD)), mac: false, to: "\(out)/ios-tinted.png")
render(light, mac: true, to: "\(out)/mac-light.png")
render(dark, mac: true, to: "\(out)/mac-dark.png")
