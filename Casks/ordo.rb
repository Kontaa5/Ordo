cask "ordo" do
  version "0.1.13"
  sha256 "dac0995fd20918c208f971afe2e73878440164e9c74e75dcc7e773d8888bb079"

  url "https://raw.githubusercontent.com/Kontaa5/Ordo/releases/Ordo-#{version}.zip"
  name "Ordo"
  desc "Markdown-Editor mit Hashtag-Ordnern und PDF-Export"
  homepage "https://github.com/Kontaa5/Ordo"

  depends_on macos: :sonoma

  app "Ordo.app"

  # Ordo ist nicht von Apple notarisiert (kostenloser Entwickler-Account):
  # ohne diesen Schritt würde macOS das Öffnen blockieren.
  postflight_steps do
    run "/usr/bin/xattr",
        args:           ["-dr", "com.apple.quarantine", "{{appdir}}/Ordo.app"],
        writable_paths: ["Ordo.app"],
        writable_base:  :appdir
  end

  zap trash: [
    "~/Library/Application Support/Ordo",
    "~/Library/Preferences/at.ordo.notes.plist",
    "~/Library/Caches/at.ordo.notes",
  ]
end
