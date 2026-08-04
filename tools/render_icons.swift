import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let output = CommandLine.arguments[1]
let kind = CommandLine.arguments[2]
let size = 1024
let colorSpace = CGColorSpaceCreateDeviceRGB()
let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let rect = CGRect(x: 0, y: 0, width: size, height: size)

if kind == "compass" {
    context.setFillColor(CGColor(red: 0.04, green: 0.09, blue: 0.18, alpha: 1))
    context.fill(rect)
    context.setStrokeColor(CGColor(red: 0.95, green: 0.72, blue: 0.27, alpha: 1))
    context.setLineWidth(44)
    context.strokeEllipse(in: rect.insetBy(dx: 150, dy: 150))
    context.setFillColor(CGColor(red: 0.95, green: 0.72, blue: 0.27, alpha: 1))
    context.move(to: CGPoint(x: 512, y: 210)); context.addLine(to: CGPoint(x: 575, y: 512)); context.addLine(to: CGPoint(x: 512, y: 814)); context.addLine(to: CGPoint(x: 449, y: 512)); context.closePath(); context.fillPath()
    context.setFillColor(CGColor(red: 0.04, green: 0.09, blue: 0.18, alpha: 1))
    context.move(to: CGPoint(x: 512, y: 285)); context.addLine(to: CGPoint(x: 536, y: 512)); context.addLine(to: CGPoint(x: 512, y: 739)); context.addLine(to: CGPoint(x: 488, y: 512)); context.closePath(); context.fillPath()
    context.setFillColor(CGColor(red: 0.95, green: 0.72, blue: 0.27, alpha: 1)); context.fillEllipse(in: CGRect(x: 465, y: 465, width: 94, height: 94))
} else {
    context.setFillColor(CGColor(red: 0.25, green: 0.10, blue: 0.06, alpha: 1)); context.fill(rect)
    context.setStrokeColor(CGColor(red: 0.96, green: 0.78, blue: 0.48, alpha: 1)); context.setLineWidth(42)
    context.addArc(center: CGPoint(x: 512, y: 540), radius: 255, startAngle: .pi * 0.18, endAngle: .pi * 0.82, clockwise: false); context.strokePath()
    context.move(to: CGPoint(x: 300, y: 450)); context.addLine(to: CGPoint(x: 512, y: 265)); context.addLine(to: CGPoint(x: 724, y: 450)); context.strokePath()
    context.setFillColor(CGColor(red: 0.96, green: 0.78, blue: 0.48, alpha: 1)); context.fillEllipse(in: CGRect(x: 455, y: 455, width: 114, height: 114))
    context.setFillColor(CGColor(red: 0.25, green: 0.10, blue: 0.06, alpha: 1)); context.fillEllipse(in: CGRect(x: 490, y: 490, width: 44, height: 44))
}

let image = context.makeImage()!
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: output) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, image, nil)
CGImageDestinationFinalize(destination)
