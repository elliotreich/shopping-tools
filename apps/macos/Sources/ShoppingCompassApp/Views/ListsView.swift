import SwiftUI
import ShoppingCompassKit

struct ListRowView: View {
  let list: ProductList
  let onDelete: (ProductList) -> Void
  var body: some View {
    NavigationLink(value: list) {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text(list.name).lineLimit(1)
          Text("\(list.itemCount) items").font(.caption).foregroundStyle(.secondary)
        }
        Spacer()
      }
      .padding(.vertical, 4)
    }
    .contextMenu {
      Button(role: .destructive) { onDelete(list) } label: {
        Label("Delete", systemImage: "trash")
      }
    }
  }
}

struct ListsView: View {
    @Binding var selectedList: ProductList?
    @Binding var selectedProduct: Product?
    @Binding var showSearch: Bool

    @State private var lists: [ProductList] = []
    @State private var isLoading = true
    @State private var error: Error?
    @State private var showNewListField = false
    @State private var newListName = ""

    var body: some View {
        List(selection: $selectedList) {
            if isLoading {
                ProgressView().frame(maxWidth: .infinity).padding()
            } else if lists.isEmpty {
                Text("No lists yet").foregroundStyle(.secondary).padding()
            } else {
                ForEach(lists) { list in
                    ListRowView(list: list, onDelete: deleteList)
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Lists")
        .toolbar {
          ToolbarItem(placement: .primaryAction) {
            Button { showNewListField = true } label: {
              Label("New List", systemImage: "plus") }
          }
          ToolbarItem(placement: .primaryAction) {
            Button { showSearch = true } label: {
              Label("Search", systemImage: "magnifyingglass") }
          }
        }
        .overlay {
          if showNewListField {
            VStack(spacing: 0) {
              HStack {
                TextField("List name", text: $newListName)
                  .textFieldStyle(.roundedBorder)
                  .onSubmit { createList() }
                Button("Cancel") { showNewListField = false; newListName = "" }
                  .buttonStyle(.plain).foregroundStyle(.secondary)
              }.padding()
              Divider()
              Spacer()
            }
          }
        }
        .task { await loadLists() }
        .refreshable { await loadLists() }
        .alert("Error", isPresented: .constant(error != nil)) {
          Button("OK") { error = nil }
        } message: {
          Text(error?.localizedDescription ?? "Unknown error")
        }
        .onChange(of: selectedList) { _, _ in selectedProduct = nil }
    }

    private func loadLists() async {
        isLoading = true
        defer { isLoading = false }
        do {
            lists = try await APIClient.shared.getLists()
        } catch {
            self.error = error
        }
    }

    private func createList() {
        let name = newListName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        Task {
            do {
                let id = try await APIClient.shared.createList(name: name, source: "manual")
                let newList = ProductList(id: id, name: name, source: "manual")
                lists.append(newList)
                selectedList = newList
                showNewListField = false
                newListName = ""
            } catch {
                self.error = error
            }
        }
    }

    private func deleteList(_ list: ProductList) {
        Task {
            do {
                try await APIClient.shared.deleteList(id: list.id)
                lists.removeAll { $0.id == list.id }
                if selectedList?.id == list.id {
                    selectedList = nil
                }
            } catch {
                self.error = error
            }
        }
    }
}
