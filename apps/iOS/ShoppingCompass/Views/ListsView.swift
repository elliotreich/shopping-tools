import SwiftUI
import ShoppingCompassKit

// MARK: - ViewModel

@Observable
final class ListsViewModel {
    var lists: [ProductList] = []
    var isLoading = false
    var errorMessage: String?

    func loadLists() async {
        isLoading = true
        errorMessage = nil
        do {
            lists = try await APIClient.shared.getLists()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func deleteList(at offsets: IndexSet) async {
        for index in offsets {
            let list = lists[index]
            do {
                try await APIClient.shared.deleteList(id: list.id)
                lists.remove(at: index)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func createList(name: String) async {
        do {
            try await APIClient.shared.createList(name: name, source: "ios")
            await loadLists()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - View

struct ListsView: View {
    @State private var viewModel = ListsViewModel()
    @State private var showingNewListAlert = false
    @State private var newListName = ""

    var body: some View {
        Group {
            if viewModel.isLoading && viewModel.lists.isEmpty {
                ProgressView("Loading lists...")
            } else if viewModel.lists.isEmpty {
                emptyState
            } else {
                listContent
            }
        }
        .navigationTitle("My Lists")
        .task {
            await viewModel.loadLists()
        }
        .refreshable {
            await viewModel.loadLists()
        }
        .alert("Error", isPresented: errorBinding) {
            Button("OK") { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "Unknown error")
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    newListName = ""
                    showingNewListAlert = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .alert("New List", isPresented: $showingNewListAlert) {
            TextField("List name", text: $newListName)
            Button("Cancel", role: .cancel) { }
            Button("Create") {
                let name = newListName
                Task {
                    await viewModel.createList(name: name)
                }
            }
        } message: {
            Text("Enter a name for your new shopping list.")
        }
    }

    // MARK: - Subviews

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No Lists", systemImage: "list.bullet")
        } description: {
            Text("Create a shopping list to get started.")
        } actions: {
            Button("Create List") {
                showingNewListAlert = true
            }
        }
    }

    private var listContent: some View {
        List {
            ForEach(viewModel.lists) { list in
                NavigationLink {
                    ListDetailView(listId: list.id)
                } label: {
                    listRow(list)
                }
            }
            .onDelete { indexSet in
                Task {
                    await viewModel.deleteList(at: indexSet)
                }
            }
        }
    }

    private func listRow(_ list: ProductList) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(list.name)
                    .font(.headline)
                Text(list.source)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text("\(list.itemCount)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.secondary.opacity(0.15))
                .clipShape(Capsule())
        }
    }

    // MARK: - Helpers

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { viewModel.errorMessage = nil } }
        )
    }
}

#Preview {
    NavigationStack {
        ListsView()
    }
}
