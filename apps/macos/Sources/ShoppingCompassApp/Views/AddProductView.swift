import SwiftUI
import ShoppingCompassKit

struct AddProductView: View {
    let listId: Int?

    @Environment(\.dismiss) private var dismiss

    @State private var urlText = ""
    @State private var title = ""
    @State private var isAdding = false
    @State private var error: Error?

    var body: some View {
        VStack(spacing: 20) {
            Text("Add Product")
                .font(.title2)
                .fontWeight(.semibold)

            VStack(alignment: .leading, spacing: 4) {
                Text("Product URL")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("https://…", text: $urlText)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Title (optional)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("e.g. Sony WH-1000XM5", text: $title)
                    .textFieldStyle(.roundedBorder)
            }

            HStack(spacing: 12) {
                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.bordered)

                Button {
                    Task { await addAndScan() }
                } label: {
                    if isAdding {
                        ProgressView()
                            .scaleEffect(0.8)
                    } else {
                        Text("Add & Scan")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isAdding || urlText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding()
        .frame(width: 400)
        .alert("Error", isPresented: .constant(error != nil), presenting: error) { _ in
            Button("OK") { error = nil }
        } message: { error in
            Text(error.localizedDescription)
        }
    }

    private func addAndScan() async {
        let url = urlText.trimmingCharacters(in: .whitespaces)
        let productTitle = title.trimmingCharacters(in: .whitespaces)

        guard !url.isEmpty else { return }

        isAdding = true
        defer { isAdding = false }

        do {
            // If user provided a title, use it; otherwise let the backend extract one
            let titleToUse = productTitle.isEmpty ? "Imported Product" : productTitle
            let productId = try await APIClient.shared.createProduct(
                title: titleToUse,
                url: url,
                listId: listId
            )

            // Scan the URL for price data
            _ = try await APIClient.shared.scanProduct(productId: productId)

            dismiss()
        } catch {
            self.error = error
        }
    }
}
