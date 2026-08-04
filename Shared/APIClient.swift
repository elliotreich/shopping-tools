import Foundation
import SwiftUI
import AppKit

enum APIError: LocalizedError {
    case invalidURL
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "The API address is invalid."
        case .server(let message): return message
        }
    }
}

final class APIClient {
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    func get<T: Decodable>(_ path: String) async throws -> T {
        guard let url = URL(string: AppConfig.apiBase + path) else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.server(String(data: data, encoding: .utf8) ?? "The API returned an error.")
        }
        do { return try decoder.decode(T.self, from: data) }
        catch { throw APIError.server("Invalid API response: \(error.localizedDescription)") }
    }

    func health() async throws -> HealthResponse { try await get("/health") }

    func search(_ query: String, retailers: [String]) async throws -> SearchResponse {
        var parts = URLComponents(string: AppConfig.apiBase + "/search")
        parts?.queryItems = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "retailers", value: retailers.joined(separator: ","))]
        guard let url = parts?.url else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.server(String(data: data, encoding: .utf8) ?? "The API returned an error.")
        }
        do { return try decoder.decode(SearchResponse.self, from: data) }
        catch { throw APIError.server("Invalid API response: \(error.localizedDescription)") }
    }

    func resale(limit: Int = 100, minScore: Int = 0) async throws -> ResaleResponse {
        try await get("/resale?limit=\(limit)&min_score=\(minScore)")
    }
}

struct LinkButton: View {
    let title: String
    let url: String

    var body: some View {
        Button(title) {
            guard let link = URL(string: url) else { return }
            NSWorkspace.shared.open(link)
        }
        .buttonStyle(.link)
    }
}

struct APISettingsView: View {
    @AppStorage("apiBase") private var apiBase = AppConfig.defaultAPI

    var body: some View {
        Form {
            Section("Backend address") {
                TextField("API base URL", text: $apiBase)
                    .textFieldStyle(.roundedBorder)
                Text("Run your own backend and enter its address here. The public apps do not connect to a shared hosted service.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Use local default") { apiBase = AppConfig.defaultAPI }
                    Spacer()
                    Text("Example: https://your-server.example/api")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .padding()
        .frame(width: 520)
    }
}
