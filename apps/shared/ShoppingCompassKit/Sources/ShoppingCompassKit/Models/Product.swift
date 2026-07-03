import Foundation

/// A product summary returned from list and search endpoints.
public struct Product: Codable, Identifiable, Hashable, Sendable {
    public let id: Int
    public let title: String
    public let brand: String?
    public let imageUrl: String?
    public let price: Double?
    public let listId: Int?

    public init(
        id: Int,
        title: String,
        brand: String? = nil,
        imageUrl: String? = nil,
        price: Double? = nil,
        listId: Int? = nil
    ) {
        self.id = id
        self.title = title
        self.brand = brand
        self.imageUrl = imageUrl
        self.price = price
        self.listId = listId
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case title
        case brand
        case imageUrl = "image_url"
        case price
        case listId = "list_id"
    }
}

/// A store listing for a product.
public struct ProductListing: Codable, Sendable {
    public let store: String
    public let storeSlug: String
    public let price: Double?
    public let url: String?
    public let inStorePickup: Bool
    public let shippingEligible: Bool
    public let available: Bool
    public let lastFetched: String?

    public init(
        store: String,
        storeSlug: String,
        price: Double? = nil,
        url: String? = nil,
        inStorePickup: Bool = false,
        shippingEligible: Bool = false,
        available: Bool = false,
        lastFetched: String? = nil
    ) {
        self.store = store
        self.storeSlug = storeSlug
        self.price = price
        self.url = url
        self.inStorePickup = inStorePickup
        self.shippingEligible = shippingEligible
        self.available = available
        self.lastFetched = lastFetched
    }

    private enum CodingKeys: String, CodingKey {
        case store
        case storeSlug = "store_slug"
        case price
        case url
        case inStorePickup = "in_store_pickup"
        case shippingEligible = "shipping_eligible"
        case available
        case lastFetched = "last_fetched"
    }
}

/// A list membership record.
public struct ListMembership: Codable, Sendable {
    public let listId: Int
    public let listName: String?

    public init(listId: Int, listName: String? = nil) {
        self.listId = listId
        self.listName = listName
    }

    private enum CodingKeys: String, CodingKey {
        case listId = "list_id"
        case listName = "list_name"
    }
}

/// A pending match suggestion from automated scanning.
public struct PendingMatch: Codable, Sendable {
    public let id: Int
    public let storeId: Int?
    public let storeName: String?
    public let price: Double?
    public let url: String?
    public let status: String?

    public init(
        id: Int,
        storeId: Int? = nil,
        storeName: String? = nil,
        price: Double? = nil,
        url: String? = nil,
        status: String? = nil
    ) {
        self.id = id
        self.storeId = storeId
        self.storeName = storeName
        self.price = price
        self.url = url
        self.status = status
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case storeId = "store_id"
        case storeName = "store_name"
        case price
        case url
        case status
    }
}

/// Full product detail returned from `GET /api/products/:id`.
public struct ProductDetail: Codable, Identifiable, Sendable {
    public let id: Int
    public let title: String
    public let brand: String?
    public let description: String?
    public let imageUrl: String?
    public let notes: String?
    public let listings: [ProductListing]
    public let listIds: [ListMembership]
    public let pendingMatches: [PendingMatch]

    public init(
        id: Int,
        title: String,
        brand: String? = nil,
        description: String? = nil,
        imageUrl: String? = nil,
        notes: String? = nil,
        listings: [ProductListing] = [],
        listIds: [ListMembership] = [],
        pendingMatches: [PendingMatch] = []
    ) {
        self.id = id
        self.title = title
        self.brand = brand
        self.description = description
        self.imageUrl = imageUrl
        self.notes = notes
        self.listings = listings
        self.listIds = listIds
        self.pendingMatches = pendingMatches
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case title
        case brand
        case description
        case imageUrl = "image_url"
        case notes
        case listings
        case listIds = "list_ids"
        case pendingMatches = "pending_matches"
    }
}
