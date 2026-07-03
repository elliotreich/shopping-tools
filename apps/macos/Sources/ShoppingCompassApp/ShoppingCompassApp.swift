import SwiftUI
import ShoppingCompassKit

@main
struct ShoppingCompassApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowResizability(.contentSize)
        .defaultSize(width: 1000, height: 700)
    }
}
