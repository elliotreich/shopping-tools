import Foundation

struct SearchProfile: Codable {
    let keywords: [String]?
    let budget: Double?
    let location: String?
    let radiusMiles: Int?
    let vehicle: String?
    let sizeConstraints: String?
}

struct DiscoverySearch: Codable, Identifiable {
    let id: String
    let name: String
    let kind: String
    let profile: SearchProfile
    let sourceAdapters: [String]
    let schedule: String
    let status: String
    let lastRunId: String?
    let nextRunAt: String?
}

struct DiscoveryFinding: Codable, Identifiable {
    let id: String
    let searchId: String
    let kind: String
    let title: String
    let source: String
    let sourceId: String
    let url: String
    let imageURL: String?
    let price: Double?
    let isFree: Bool
    let location: String?
    let description: String?
    let score: Double?
    let scoreReasons: [String]
    let discoveredAt: String?
    let freshness: String?
    let status: String
    let company: String?
    let role: String?
    let salary: String?
    let fitScore: Double?
    let applicationStatus: String?
}

struct DiscoveryOperation: Codable, Identifiable {
    let id: String
    let searchId: String
    let startedAt: String
    let finishedAt: String?
    let status: String
    let runtimeSeconds: Double?
    let fetchedCount: Int
    let retainedCount: Int
    let rejectedCount: Int
    let notificationCount: Int
    let sourceErrors: [String]
}

struct SearchesResponse: Codable { let searches: [DiscoverySearch] }
struct FindingsResponse: Codable { let findings: [DiscoveryFinding] }
struct OperationsResponse: Codable { let operations: [DiscoveryOperation] }

enum AppConfig {
    static let defaultAPI = "http://100.121.190.104:8091/api"
    static var apiBase: String { UserDefaults.standard.string(forKey: "apiBase") ?? defaultAPI }
    static var apiToken: String { UserDefaults.standard.string(forKey: "apiToken") ?? "" }
}
