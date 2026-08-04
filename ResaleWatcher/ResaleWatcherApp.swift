import SwiftUI

@main
struct ResaleWatcherApp: App {
    var body: some Scene {
        WindowGroup("Resale Watcher") { ResaleWatcherView() }
    }
}

struct ResaleWatcherView: View {
    @State private var listings: [ResaleListing] = []
    @State private var minScore = 50
    @State private var status = "Loading watcher findings…"
    @State private var isLoading = false
    private let client = APIClient()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading) {
                    Text("Resale Watcher").font(.largeTitle.bold())
                    Text("A focused feed for resale listings.").foregroundStyle(.secondary)
                }
                Spacer()
                Button("Refresh") { load() }.disabled(isLoading)
            }
            HStack {
                Text("Minimum score")
                Slider(value: Binding(get: { Double(minScore) }, set: { minScore = Int($0) }), in: 0...85, step: 5)
                Text("\(minScore)").monospacedDigit()
            }
            Text(status).font(.callout).foregroundStyle(.secondary)
            List(listings) { listing in
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text(listing.title).font(.headline).lineLimit(2)
                        Spacer()
                        if let score = listing.score { Text("\(score)").font(.title3.bold()).foregroundStyle(score >= 70 ? .green : .secondary) }
                    }
                    HStack {
                        Text(listing.brand ?? "Unknown brand")
                        Text("•")
                        Text(listing.platform.capitalized)
                        if let price = listing.price { Text("• " + price.formatted(.currency(code: "USD"))) }
                    }.font(.subheadline).foregroundStyle(.secondary)
                    LinkButton(title: "Open listing", url: listing.url)
                }.padding(.vertical, 5)
            }
        }
        .padding(24)
        .frame(minWidth: 760, minHeight: 560)
        .task { load() }
    }

    private func load() {
        isLoading = true; status = "Loading from VPS…"
        Task {
            do {
                let response = try await client.resale(minScore: minScore)
                listings = response.listings
                status = "Showing \(response.count) findings from the watcher database."
            } catch { status = "Watcher unavailable: \(error.localizedDescription)" }
            isLoading = false
        }
    }
}
