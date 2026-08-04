import SwiftUI

@main
struct ShoppingCompassApp: App {
    var body: some Scene {
        WindowGroup("Shopping Compass") { ShoppingCompassView() }
        Settings { APISettingsView() }
    }
}

struct ShoppingCompassView: View {
    @State private var query = ""
    @State private var selected = Set(["target", "walmart", "amazon", "homedepot", "costco"])
    @State private var results: [RetailerResult] = []
    @State private var status = "Search for an item to compare current retailer offers."
    @State private var isSearching = false
    private let client = APIClient()
    private let retailers = [
        ("target", "Target"), ("walmart", "Walmart"), ("amazon", "Amazon"),
        ("homedepot", "Home Depot"), ("costco", "Costco")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Shopping Compass").font(.largeTitle.bold())
            Text("Compare the same item across the stores you actually use.").foregroundStyle(.secondary)
            HStack {
                TextField("e.g. 55-inch TCL QLED TV", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { search() }
                Button(isSearching ? "Searching…" : "Compare") { search() }
                    .disabled(query.trimmingCharacters(in: .whitespaces).isEmpty || isSearching)
            }
            HStack {
                ForEach(retailers, id: \.0) { id, name in
                    Toggle(name, isOn: Binding(get: { selected.contains(id) }, set: { on in
                        if on { selected.insert(id) } else { selected.remove(id) }
                    }))
                        .toggleStyle(.checkbox)
                }
            }
            Text(status).font(.callout).foregroundStyle(.secondary)
            List(results) { result in
                VStack(alignment: .leading, spacing: 5) {
                    Text(result.title).font(.headline)
                    Text(result.retailer.capitalized).font(.subheadline.bold())
                    Text(result.snippet).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                    LinkButton(title: "Open listing", url: result.url)
                }.padding(.vertical, 5)
            }
        }
        .padding(24)
        .frame(minWidth: 760, minHeight: 560)
    }

    private func search() {
        isSearching = true; status = "Searching selected retailers…"
        Task {
            do {
                let response = try await client.search(query, retailers: Array(selected))
                results = response.retailers.flatMap(\.results)
                status = response.errors.isEmpty ? "Found \(results.count) candidate listings." : "Found \(results.count) results; \(response.errors.count) retailer searches failed."
            } catch { status = "Search failed: \(error.localizedDescription)" }
            isSearching = false
        }
    }
}
