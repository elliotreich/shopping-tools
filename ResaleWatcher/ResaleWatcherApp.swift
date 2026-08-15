import SwiftUI

@main
struct ResaleWatcherApp: App {
    var body: some Scene {
        WindowGroup("Discovery Review") { DiscoveryReviewView() }
    }
}

@MainActor
final class DiscoveryModel: ObservableObject {
    @Published var searches: [DiscoverySearch] = []
    @Published var findings: [DiscoveryFinding] = []
    @Published var operations: [DiscoveryOperation] = []
    @Published var selectedSearchID: String?
    @Published var message = "Enter the API token in Settings, then refresh."
    @Published var isLoading = false
    private let client = APIClient()

    func refresh() async {
        isLoading = true
        do {
            searches = try await client.searches()
            if selectedSearchID == nil { selectedSearchID = searches.first?.id }
            findings = try await client.findings(searchID: selectedSearchID)
            operations = try await client.operations(searchID: selectedSearchID)
            message = "Updated \(findings.count) reviewable findings."
        } catch {
            message = error.localizedDescription
        }
        isLoading = false
    }

    func selectSearch(_ id: String?) async {
        selectedSearchID = id
        do {
            findings = try await client.findings(searchID: id)
            operations = try await client.operations(searchID: id)
        } catch { message = error.localizedDescription }
    }

    func searchAction(_ search: DiscoverySearch, _ action: String) async {
        do {
            try await client.searchAction(search.id, action)
            message = "\(action.capitalized) requested for \(search.name)."
            await refresh()
        } catch { message = error.localizedDescription }
    }

    func findingAction(_ finding: DiscoveryFinding, _ action: String) async {
        do {
            try await client.findingAction(finding.id, action)
            message = "Marked \(action)."
            await refresh()
        } catch { message = error.localizedDescription }
    }
}

struct DiscoveryReviewView: View {
    @StateObject private var model = DiscoveryModel()
    @State private var section = "Review"

    var body: some View {
        NavigationSplitView {
            List(selection: $section) {
                Label("Review", systemImage: "square.grid.2x2").tag("Review")
                Label("Searches", systemImage: "magnifyingglass").tag("Searches")
                Label("Operations", systemImage: "waveform.path.ecg").tag("Operations")
                Label("Settings", systemImage: "gearshape").tag("Settings")
            }
            .navigationTitle("Discovery")
            .frame(minWidth: 190)
        } detail: {
            Group {
                switch section {
                case "Searches": SearchesView(model: model)
                case "Operations": OperationsView(model: model)
                case "Settings": SettingsView()
                default: ReviewView(model: model)
                }
            }
            .toolbar {
                ToolbarItem {
                    Button { Task { await model.refresh() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                        .disabled(model.isLoading)
                }
            }
        }
        .task { await model.refresh() }
        .frame(minWidth: 1050, minHeight: 720)
    }
}

struct ReviewView: View {
    @ObservedObject var model: DiscoveryModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading) {
                    Text("Review inbox").font(.largeTitle.bold())
                    Text(model.message).foregroundStyle(.secondary)
                }
                Spacer()
                Picker("Search", selection: Binding(get: { model.selectedSearchID ?? "all" }, set: { value in Task { await model.selectSearch(value == "all" ? nil : value) } })) {
                    Text("All searches").tag("all")
                    ForEach(model.searches) { Text($0.name).tag($0.id) }
                }
                .frame(width: 220)
            }
            ScrollView {
                LazyVStack(spacing: 14) {
                    ForEach(model.findings) { finding in FindingCard(finding: finding) { action in Task { await model.findingAction(finding, action) } } }
                }
            }
        }
        .padding(24)
    }
}

struct FindingCard: View {
    let finding: DiscoveryFinding
    let action: (String) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            if let image = finding.imageURL, URL(string: image) != nil, !image.isEmpty {
                RemoteImage(url: image)
                .frame(width: 180, height: 135).clipShape(RoundedRectangle(cornerRadius: 10))
            } else {
                ZStack { Color.accentColor.opacity(0.12); Image(systemName: finding.kind == "jobs" ? "briefcase.fill" : "leaf.fill").font(.system(size: 36)).foregroundStyle(.tint) }
                    .frame(width: 180, height: 135).clipShape(RoundedRectangle(cornerRadius: 10))
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(finding.title).font(.headline).lineLimit(2)
                    Spacer()
                    if let score = finding.score { Text("\(Int(score))").font(.title2.bold()).foregroundStyle(score >= 75 ? .green : .secondary) }
                }
                HStack(spacing: 8) {
                    if finding.kind == "jobs", let company = finding.company { Text(company) }
                    else if finding.isFree { Text("FREE").fontWeight(.bold).foregroundStyle(.green) }
                    else if let price = finding.price { Text(price.formatted(.currency(code: "USD"))).fontWeight(.semibold) }
                    if let location = finding.location, !location.isEmpty { Text("• \(location)") }
                    Text("• \(finding.source)")
                }.font(.subheadline).foregroundStyle(.secondary)
                if let description = finding.description { Text(description).font(.callout).foregroundStyle(.secondary).lineLimit(3) }
                if !finding.scoreReasons.isEmpty { Text(finding.scoreReasons.joined(separator: "  •  ")).font(.caption).foregroundStyle(.tint) }
                HStack {
                    LinkButton(title: "Open original", url: finding.url)
                    Spacer()
                    ForEach(finding.kind == "jobs" ? ["save", "dismiss", "contacted", "applied", "restore"] : ["save", "dismiss", "contacted", "purchased", "expired", "restore"], id: \.self) { value in
                        Button(value.capitalized) { action(value) }.buttonStyle(.borderless).font(.caption)
                    }
                }
            }
        }
        .padding(16).background(.regularMaterial).clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct SearchesView: View {
    @ObservedObject var model: DiscoveryModel
    @State private var editing: DiscoverySearch?

    var body: some View {
        List(model.searches) { search in
            VStack(alignment: .leading, spacing: 8) {
                HStack { Text(search.name).font(.headline); Spacer(); Text(search.status.capitalized).foregroundStyle(.secondary) }
                Text(search.profile.keywords?.joined(separator: " • ") ?? "").font(.subheadline).foregroundStyle(.secondary)
                Text("Sources: \(search.sourceAdapters.joined(separator: ", "))  ·  Schedule: \(search.schedule)").font(.caption).foregroundStyle(.secondary)
                if let nextRunAt = search.nextRunAt { Text("Next run: \(nextRunAt)").font(.caption).foregroundStyle(.secondary) }
                HStack {
                    Button("Run Now") { Task { await model.searchAction(search, "run") } }
                    if search.status == "paused" { Button("Resume") { Task { await model.searchAction(search, "resume") } } }
                    else if search.status == "active" { Button("Pause") { Task { await model.searchAction(search, "pause") } } }
                    if search.status != "completed" { Button("Complete") { Task { await model.searchAction(search, "complete") } } }
                    Button("Edit") { editing = search }
                }.buttonStyle(.borderless)
            }.padding(.vertical, 8)
        }.navigationTitle("Searches")
            .sheet(item: $editing) { search in EditSearchView(search: search, model: model) }
    }
}

struct EditSearchView: View {
    let search: DiscoverySearch
    @ObservedObject var model: DiscoveryModel
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var keywords: String
    @State private var budget: String
    @State private var location: String
    @State private var schedule: String

    init(search: DiscoverySearch, model: DiscoveryModel) {
        self.search = search
        self.model = model
        _name = State(initialValue: search.name)
        _keywords = State(initialValue: search.profile.keywords?.joined(separator: ", ") ?? "")
        _budget = State(initialValue: search.profile.budget.map { String($0) } ?? "")
        _location = State(initialValue: search.profile.location ?? "")
        _schedule = State(initialValue: search.schedule)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Edit search").font(.title.bold())
            TextField("Name", text: $name)
            TextField("Keywords, comma separated", text: $keywords)
            TextField("Budget", text: $budget)
            TextField("Location", text: $location)
            TextField("Cron schedule", text: $schedule)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Save") {
                    Task {
                        try? await APIClient().updateSearch(search.id, name: name, keywords: keywords, budget: budget, location: location, schedule: schedule)
                        await model.refresh()
                        dismiss()
                    }
                }.buttonStyle(.borderedProminent)
            }
        }.padding(24).frame(width: 420)
    }
}

struct OperationsView: View {
    @ObservedObject var model: DiscoveryModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let search = model.searches.first(where: { $0.id == model.selectedSearchID }), let nextRunAt = search.nextRunAt {
                Text("Next run for \(search.name): \(nextRunAt)").font(.subheadline).foregroundStyle(.secondary).padding(16)
            }
            List(model.operations) { operation in
            VStack(alignment: .leading, spacing: 6) {
                HStack { Text(operation.status.capitalized).font(.headline); Spacer(); Text(operation.startedAt).font(.caption).foregroundStyle(.secondary) }
                Text("Fetched \(operation.fetchedCount)  ·  Retained \(operation.retainedCount)  ·  Rejected \(operation.rejectedCount)  ·  Notifications \(operation.notificationCount)").font(.subheadline)
                if let runtime = operation.runtimeSeconds { Text("Runtime \(runtime, specifier: "%.1f")s") .font(.caption).foregroundStyle(.secondary) }
                if !operation.sourceErrors.isEmpty { Text(operation.sourceErrors.joined(separator: "\n")).foregroundStyle(.red).font(.caption) }
            }.padding(.vertical, 8)
            }
        }.navigationTitle("Operations")
    }
}

struct SettingsView: View {
    @AppStorage("apiBase") private var apiBase = AppConfig.defaultAPI
    @AppStorage("apiToken") private var apiToken = ""

    var body: some View {
        Form {
            Section("Discovery API") {
                TextField("API base URL", text: $apiBase)
                SecureField("Bearer token", text: $apiToken)
                Text("The token is stored in this Mac app's preferences and is never committed to the project.").font(.caption).foregroundStyle(.secondary)
            }
        }.formStyle(.grouped).navigationTitle("Settings").padding(24)
    }
}
