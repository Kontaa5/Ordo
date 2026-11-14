import Foundation

/// Notices when a note suddenly holds another note's text instead of its own – iCloud once
/// mixed up two files that way (their old dates stayed, the content came from other notes).
enum ContentGuard {
    /// Lines long enough to say something about a note (short ones like "---" or "# Titel" repeat everywhere).
    nonisolated static func lines(_ s: String) -> Set<String> {
        Set(s.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { $0.count > 25 })
    }

    /// The other note whose text `new` is, when `new` shares (almost) nothing with `old`; nil otherwise.
    nonisolated static func foreignSource(path: String, old: String, new: String, others: [String: String]) -> String? {
        let o = lines(old), n = lines(new)
        guard o.count >= 3, n.count >= 3 else { return nil }
        let kept = Double(n.intersection(o).count)
        guard kept / Double(n.count) < 0.1, kept / Double(o.count) < 0.1 else { return nil }
        var best: (share: Double, path: String)?
        for (p, text) in others where p != path {
            let share = Double(n.intersection(lines(text)).count) / Double(n.count)
            if share >= 0.8, share > (best?.share ?? 0) { best = (share, p) }
        }
        return best?.path
    }
}
