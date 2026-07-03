// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ShoppingCompassKit",
    platforms: [
        .macOS(.v14),
        .iOS(.v17),
    ],
    products: [
        .library(
            name: "ShoppingCompassKit",
            targets: ["ShoppingCompassKit"]
        ),
    ],
    targets: [
        .target(name: "ShoppingCompassKit"),
    ]
)
