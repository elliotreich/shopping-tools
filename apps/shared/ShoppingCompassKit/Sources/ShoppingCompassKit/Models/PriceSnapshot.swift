import Foundation

/// A single price observation for a product at a store.
public struct PriceSnapshot: Codable, Sendable {
    public let storeId: Int
    public let storeName: String
    public let price: Double?
    public let inStorePickup: Bool
    public let shippingEligible: Bool
    public let available: Bool
    public let fetchedAt: String?
    public let url: String?

    public init(
        storeId: Int,
        storeName: String,
        price: Double? = nil,
        inStorePickup: Bool = false,
        shippingEligible: Bool = false,
        available: Bool = false,
        fetchedAt: String? = nil,
        url: String? = nil
    ) {
        self.storeId = storeId
        self.storeName = storeName
        self.price = price
        self.inStorePickup = inStorePickup
        self.shippingEligible = shippingEligible
        self.available = available
        self.fetchedAt = fetchedAt
        self.url = url
    }

    private enum CodingKeys: String, CodingKey {
        case storeId = "store_id"
        case storeName = "store_name"
        case price
        case inStorePickup = "in_store_pickup"
        case shippingEligible = "shipping_eligible"
        case available
        case fetchedAt = "fetched_at"
        case url
    }
}
