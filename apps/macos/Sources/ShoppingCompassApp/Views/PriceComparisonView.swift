import SwiftUI
import ShoppingCompassKit

/// Displays price history for a single product across stores.
///
/// In the current iteration, shows the latest price per store. A full
/// history will appear once snapshots accumulate over multiple scans.
struct PriceComparisonView: View {
    let productId: Int

    @State private var snapshots: [PriceSnapshot] = []
    @State private var isLoading = true
    @State private var error: Error?

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if snapshots.isEmpty {
                ContentUnavailableView(
                    "No Price Data",
                    systemImage: "chart.bar.xaxis",
                    description: Text("Scan this product to collect price snapshots.")
                )
            } else {
                List(snapshots, id: \.storeId) { snapshot in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(snapshot.storeName)
                                .fontWeight(.medium)
                            if let date = snapshot.fetchedAt {
                                Text(formatDate(date))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Spacer()

                        if let price = snapshot.price {
                            Text(price, format: .currency(code: "USD"))
                                .fontWeight(.semibold)
                                .monospacedDigit()
                        } else {
                            Text("—")
                                .foregroundStyle(.secondary)
                        }

                        if snapshot.available {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        }

                        if snapshot.shippingEligible {
                            Image(systemName: "shippingbox.fill")
                                .foregroundStyle(.blue)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listStyle(.inset)
            }
        }
        .navigationTitle("Price History")
        .task(id: productId) {
            await loadSnapshots()
        }
        .alert("Error", isPresented: .constant(error != nil), presenting: error) { _ in
            Button("OK") { error = nil }
        } message: { error in
            Text(error.localizedDescription)
        }
    }

    private func loadSnapshots() async {
        isLoading = true
        defer { isLoading = false }
        do {
            snapshots = try await APIClient.shared.getProductPrices(id: productId)
        } catch {
            self.error = error
        }
    }

    private func formatDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else {
            return iso
        }
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .abbreviated
        return relative.localizedString(for: date, relativeTo: Date())
    }
}
