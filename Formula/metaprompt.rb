# Homebrew formula for the Metaprompt bash CLI + Helm chart.
# Tap this repo: brew tap e-jerk/metaprompt https://github.com/e-jerk/metaprompt
# Install (until v0.1.0 is tagged): brew install --HEAD metaprompt
class Metaprompt < Formula
  desc "Kubernetes control plane CLI for swappable coding harnesses"
  homepage "https://metaprom.pt"
  license "MIT"
  head "https://github.com/e-jerk/metaprompt.git", branch: "main"

  # After v0.1.0 is tagged, add:
  # url "https://github.com/e-jerk/metaprompt/archive/refs/tags/v0.1.0.tar.gz"
  # sha256 "<github archive sha256>"
  # version "0.1.0"

  # Cluster commands exec docker run / Apple container run of
  # ghcr.io/e-jerk/metaprompt/cli (helm, kubectl, k3d, chart).
  uses_from_macos "curl"
  uses_from_macos "python"

  def install
    inreplace "cli/metaprompt",
              'METAPROMPT_SHARE_DEFAULT=""',
              "METAPROMPT_SHARE_DEFAULT=\"#{pkgshare}\""
    bin.install "cli/metaprompt"
    pkgshare.install "deploy", "scripts", "k3c.yaml"
  end

  test do
    assert_match "metaprompt 0.1.0", shell_output("#{bin}/metaprompt version")
    assert_match "brew install", shell_output("#{bin}/metaprompt help")
    json = shell_output("#{bin}/metaprompt call --dry-run harness.list")
    assert_match '"harness.list"', json
    refute_match(/Bearer|alice-token/i, json)
  end
end
