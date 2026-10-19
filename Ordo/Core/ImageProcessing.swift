import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

/// Image handling on insert: shrink, convert, compress.
enum ImageProcessing {
    /// Files above this size are re-encoded to save space (iCloud, phone).
    static let compressThreshold = 1_000_000

    /// Scales large photos down, converts HEIC to JPEG (readable everywhere) and,
    /// with `compress`, re-encodes big files: JPEG at quality 0.8, opaque PNG
    /// photos as JPEG. The result is only used when it is actually smaller.
    static func process(_ data: Data, ext: String, maxDim: Int, convertHEIC: Bool, compress: Bool = true) -> (Data, String) {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] else { return (data, ext) }
        let w = props[kCGImagePropertyPixelWidth] as? Int ?? 0
        let h = props[kCGImagePropertyPixelHeight] as? Int ?? 0
        let orientation = props[kCGImagePropertyOrientation] as? Int ?? 1
        let hasAlpha = props[kCGImagePropertyHasAlpha] as? Bool ?? false
        let isHEIC = ext == "heic" || ext == "heif"
        let tooBig = maxDim > 0 && max(w, h) > maxDim
        let heavy = compress && data.count > compressThreshold
        guard tooBig || heavy || (isHEIC && convertHEIC) || orientation != 1 else { return (data, ext) }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: tooBig ? maxDim : max(w, h),
        ]
        guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return (data, ext) }
        func encode(_ type: UTType, quality: Double) -> Data? {
            let out = NSMutableData()
            guard let dest = CGImageDestinationCreateWithData(out, type.identifier as CFString, 1, nil) else { return nil }
            CGImageDestinationAddImage(dest, img, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
            return CGImageDestinationFinalize(dest) ? out as Data : nil
        }
        var result: (Data, String)?
        if ext == "png" {
            let png = encode(.png, quality: 1)
            result = png.map { ($0, "png") }
            // a big PNG without transparency is almost always a photo or a screenshot: JPEG is far smaller
            if heavy, !hasAlpha, let jpg = encode(.jpeg, quality: 0.85), jpg.count < (png?.count ?? .max) { result = (jpg, "jpg") }
        } else {
            result = encode(.jpeg, quality: heavy ? 0.8 : 0.85).map { ($0, "jpg") }
        }
        guard let r = result else { return (data, ext) }
        // never make a file bigger, unless the format had to change (HEIC) or the picture was rotated/scaled
        if r.0.count >= data.count && !(isHEIC && convertHEIC) && !tooBig && orientation == 1 { return (data, ext) }
        return r
    }

    /// Result of shrinking a picture that is already in the vault.
    struct Shrunk { var data: Data; var oldSize: (w: Int, h: Int); var newSize: (w: Int, h: Int) }

    /// Pixel size of a picture file (nil if it can't be read).
    static func pixelSize(_ data: Data) -> (w: Int, h: Int)? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let p = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let w = p[kCGImagePropertyPixelWidth] as? Int, let h = p[kCGImagePropertyPixelHeight] as? Int else { return nil }
        return (w, h)
    }

    /// For pictures already in the vault: a smaller version in the same format
    /// (so every link keeps working), scaled to at most `maxDim` px (0 = keep the
    /// resolution). nil if it would not save at least 10 %.
    /// `targetWidth` > 0: scale only as far as the width stays at least that many px (keeps print sharpness).
    static func shrinkKeepingFormat(_ data: Data, ext: String, maxDim: Int, targetWidth: Int = 0) -> Shrunk? {
        let e = ext.lowercased()
        guard ["jpg", "jpeg", "png"].contains(e),
              let src = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] else { return nil }
        let w = props[kCGImagePropertyPixelWidth] as? Int ?? 0, h = props[kCGImagePropertyPixelHeight] as? Int ?? 0
        var limit = max(w, h)
        if maxDim > 0 { limit = min(limit, maxDim) }
        if targetWidth > 0, w > targetWidth { limit = min(limit, Int((Double(max(w, h)) * Double(targetWidth) / Double(w)).rounded(.up))) }
        let scaled = limit < max(w, h)
        if e == "png" && !scaled { return nil }   // lossless: only scaling helps
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: limit,
        ]
        guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        let out = NSMutableData()
        let type = (e == "png" ? UTType.png : UTType.jpeg).identifier as CFString
        guard let dest = CGImageDestinationCreateWithData(out, type, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, img, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        guard CGImageDestinationFinalize(dest), out.length < data.count * 9 / 10 else { return nil }
        return Shrunk(data: out as Data, oldSize: (w, h), newSize: (img.width, img.height))
    }
}
