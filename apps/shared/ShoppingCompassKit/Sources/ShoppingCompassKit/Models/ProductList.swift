import Foundation

/// A product list (wish list / shopping list).
public struct ProductList: Codable, Identifiable, Hashable, Sendable {
    public let id: Int
    public let name: String
    public let source: String
    public let itemCount: Int
    public let createdAt: String?

    public init(
        id: Int,
        name: String,
        source: String,
        itemCount: Int = 0,
        createdAt: String? = nil
    ) {
        self.id = id
        self.name = name
        self.source = source
        self.itemCount = itemCount
        self.createdAt = createdAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case source
        case itemCount = "item_count"
        case createdAt = "created_at"
    }
}

/// An item within a product list.
public struct ListItem: Codable, Sendable {
    public let productId: Int
    public let title: String
    public let brand: String?
    public let price: Double?
    public let imageUrl: String?

    public init(
        productId: Int,
        title: String,
        brand: String? = nil,
        price: Double? = nil,
        imageUrl: String? = nil
    ) {
        self.productId = productId
        self.title = title
        self.brand = brand
        self.price = price
        self.imageUrl = imageUrl
    }

    private enum CodingKeys: String, CodingKey {
        case productId = "product_id"
        case title
        case brand
        case price
        case imageUrl = "image_url"
    }
}

/// Full list detail returned from `GET /api/lists/:id`.
public struct ListDetail: Codable, Identifiable, Sendable {
    public let id: Int
    public let name: String
    public let source: String
    public let items: [ListItem]

    public init(
        id: Int,
        name: String,
        source: String,
        items: [ListItem] = []
    ) {
        self.id = id
        self.name = name
        self.source = source
        self.items = items
    }
}
