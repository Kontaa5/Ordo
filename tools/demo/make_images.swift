// Demo pictures for the Ordo demo vault: coloured "board photos" with a label,
// plus one big photo (> 1 MB) to try "Große Bilder verkleinern".
// Usage: swift tools/demo/make_images.swift <attachments-folder>
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

func rgb(_ hex: UInt32) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
}

func picture(_ name: String, w: Int, h: Int, from: UInt32, to: UInt32, label: String, noise: Bool = false, type: UTType = .png, dir: String) {
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    let grad = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [rgb(from), rgb(to)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(grad, start: .zero, end: CGPoint(x: w, y: h), options: [])
    // a few soft shapes so pictures are easy to tell apart when cropping
    ctx.setFillColor(CGColor(gray: 1, alpha: 0.18))
    ctx.fillEllipse(in: CGRect(x: w / 8, y: h / 5, width: w / 3, height: w / 3))
    ctx.setFillColor(CGColor(gray: 0, alpha: 0.12))
    ctx.fill(CGRect(x: w / 2, y: h / 6, width: w / 3, height: h / 2))
    if noise {
        // photo-like grain: makes the file big
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        for i in stride(from: 0, to: bytes.count, by: 4) { let v = UInt8.random(in: 0...60); bytes[i] = v; bytes[i + 1] = v; bytes[i + 2] = v; bytes[i + 3] = 40 }
        let grain = CGContext(data: &bytes, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.draw(grain.makeImage()!, in: CGRect(x: 0, y: 0, width: w, height: h))
    }
    let font = CTFontCreateWithName("Helvetica-Bold" as CFString, CGFloat(h) / 9, nil)
    let attr = NSAttributedString(string: label, attributes: [kCTFontAttributeName as NSAttributedString.Key: font, kCTForegroundColorAttributeName as NSAttributedString.Key: CGColor(gray: 1, alpha: 0.95)])
    let line = CTLineCreateWithAttributedString(attr)
    ctx.textPosition = CGPoint(x: CGFloat(w) / 16, y: CGFloat(h) / 12)
    CTLineDraw(line, ctx)
    let url = URL(fileURLWithPath: dir).appendingPathComponent(name)
    let out = NSMutableData()
    let d = CGImageDestinationCreateWithData(out, type.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(d, ctx.makeImage()!, [kCGImageDestinationLossyCompressionQuality: noise ? 1.0 : 0.85] as CFDictionary)
    CGImageDestinationFinalize(d)
    try! (out as Data).write(to: url)
}

let dir = CommandLine.arguments[1]
try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
picture("Szene 1.jpg", w: 900, h: 600, from: 0xF2A65A, to: 0xC0392B, label: "Szene 1 – Totale", type: .jpeg, dir: dir)
picture("Szene 2.jpg", w: 900, h: 600, from: 0x5DADE2, to: 0x1B4F72, label: "Szene 2 – Nah", type: .jpeg, dir: dir)
picture("Szene 3.jpg", w: 900, h: 600, from: 0x58D68D, to: 0x196F3D, label: "Szene 3 – Detail", type: .jpeg, dir: dir)
picture("ER-Diagramm.png", w: 1000, h: 640, from: 0xECECEC, to: 0xBDBDBD, label: "ER-Diagramm Konto", dir: dir)
picture("Klassenfoto groß.jpg", w: 2000, h: 1500, from: 0x8E9AAF, to: 0x3D405B, label: "Klassenfoto (groß)", noise: true, type: .jpeg, dir: dir)
print("ok")
