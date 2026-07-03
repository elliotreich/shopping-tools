import Foundation

/// A store that can be scraped for price comparisons.
public struct Store: Codable, Identifiable, Hashable, Sendable {
    public let id: Int
    public let name: String
    public let slug: String
    public let active: Bool
    public let baseUrl: String?

    public init(
        id: Int,
        name: String,
        slug: String,
        active: Bool = true,
        baseUrl: String? = nil
    ) {
        self.id = id
        self.name = name
        self.slug = slug
        self.active = active
        self.baseUrl = baseUrl
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case slug
        case active
        case baseUrl = "base_url"
    }
}
