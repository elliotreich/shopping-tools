import SwiftUI
import ShoppingCompassKit

// MARK: - ViewModel

@Observable
final class AddProductViewModel {
    var url = ""
    var title = ""
    var isLoading = false
    var errorMessage: String?

    func addProduct(listId: Int) async -> Bool {
        let trimmedURL = url.trimmingCharacters(in: .whitespaces)
        guard !trimmedURL.isEmpty else {
            errorMessage = "Please enter a product URL."
            return false
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let productId = try await APIClient.shared.createProduct(
                title: title.trimmingCharacters(in: .whitespaces).isEmpty ? nil : title,
                url: trimmedURL,
                listId: listId
            )
            // Kick off a scan in the background to gather prices immediately.
            Task { try? await APIClient.shared.scanProduct(productId: productId) }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}

// MARK: - View

struct AddProductView: View {
    let listId: Int
    let onDismiss: (() -> Void)?

    @State private var viewModel = AddProductViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Product URL") {
                    TextField("https://example.com/product", text: $viewModel.url)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                }

                Section("Title (optional)") {
                    TextField("Product name", text: $viewModel.title)
                }

                Section {
                    Button(action: addProductAction) {
                        HStack {
                            Spacer()
                            if viewModel.isLoading {
                                ProgressView()
                                    .tint(.white)
                                Text("Adding...")
                            } else {
                                Text("Add Product")
                                    .fontWeight(.semibold)
                            }
                            Spacer()
                        }
                    }
                    .disabled(viewModel.isLoading || viewModel.url.trimmingCharacters(in: .whitespaces).isEmpty)
                    .listRowBackground(viewModel.isLoading ? Color.blue.opacity(0.5) : Color.blue)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
            .navigationTitle("Add Product")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .alert("Error", isPresented: errorBinding) {
                Button("OK") { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "Unknown error")
            }
            .interactiveDismissDisabled(viewModel.isLoading)
        }
    }

    private func addProductAction() {
        Task {
            let success = await viewModel.addProduct(listId: listId)
            if success {
                onDismiss?()
                dismiss()
            }
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { viewModel.errorMessage = nil } }
        )
    }
}

#Preview {
    AddProductView(listId: 1, onDismiss: nil)
}
