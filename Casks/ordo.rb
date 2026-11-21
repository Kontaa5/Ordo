cask "ordo" do
  version "0.1.18"
  sha256 "f53a3ce9e82db0f5b5a75148c487511bc8b95c19d0e765c3f1382efff3e45fc1"

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
