"""Unit tests for prefill.py's price/size parsing and flattening.

Pure parsing plus a mocked search.search() - no network access.
"""
import unittest
from unittest import mock

import prefill


class ParseOfferTests(unittest.TestCase):
    def test_price_and_ounces(self):
        parsed = prefill.parse_offer("Fruity Pebbles 18.9 oz - $6.49")
        self.assertEqual(
            parsed,
            {
                "price": 6.49,
                "size": 18.9,
                "unitType": "weight",
                "unit": "oz",
                "deal": None,
            },
        )

    def test_two_for_ten_sets_per_item_price(self):
        parsed = prefill.parse_offer("Cereal 18.9 oz 2 for $10")
        self.assertEqual(parsed["price"], 5.0)
        self.assertEqual(parsed["deal"], {"type": "multi", "value": 2, "extra": 10})

    def test_buy_two_get_one(self):
        parsed = prefill.parse_offer("Buy 2 Get 1 Free - 110 ct $3.00")
        self.assertEqual(parsed["price"], 3.0)
        self.assertEqual(parsed["size"], 110)
        self.assertEqual(parsed["unitType"], "count")
        self.assertEqual(parsed["deal"], {"type": "bogo", "value": 2, "extra": 1})

    def test_percent_off(self):
        parsed = prefill.parse_offer("20% off - $6.79 18.9 oz")
        self.assertEqual(parsed["price"], 6.79)
        self.assertEqual(parsed["deal"], {"type": "pct", "value": 20.0})

    def test_bare_price_before_unit(self):
        parsed = prefill.parse_offer("6.49 for 18.9 oz")
        self.assertEqual(parsed["price"], 6.49)
        self.assertEqual(parsed["unit"], "oz")

    def test_pounds_map_to_weight(self):
        parsed = prefill.parse_offer("Coffee 1 lb - $5.00")
        self.assertEqual(parsed["unitType"], "weight")
        self.assertEqual(parsed["unit"], "lb")

    def test_fluid_ounces_map_to_volume(self):
        parsed = prefill.parse_offer("Juice 16.9 fl oz - $2.29")
        self.assertEqual(parsed["unitType"], "volume")
        self.assertEqual(parsed["unit"], "fl oz")
        self.assertEqual(parsed["size"], 16.9)

    def test_liters_map_to_volume(self):
        parsed = prefill.parse_offer("Seltzer 1 L - $1.50")
        self.assertEqual(parsed["unitType"], "volume")
        self.assertEqual(parsed["unit"], "L")

    def test_count_pack(self):
        parsed = prefill.parse_offer("Duracell AA (4 pack) - $9.99")
        self.assertEqual(parsed["unitType"], "count")
        self.assertEqual(parsed["unit"], "pack")
        self.assertEqual(parsed["size"], 4)

    def test_no_price_is_none(self):
        self.assertIsNone(prefill.parse_offer("Fruity Pebbles 18.9 oz"))

    def test_no_size_is_none(self):
        self.assertIsNone(prefill.parse_offer("Fruity Pebbles - $6.49"))

    def test_garbage_is_none(self):
        self.assertIsNone(prefill.parse_offer("Free shipping on orders over $35"))
        self.assertIsNone(prefill.parse_offer(""))
        self.assertIsNone(prefill.parse_offer(None))

    def test_price_in_multi_deal_not_double_counted(self):
        # "2 for $10" must not leave price at 10 and also set a deal.
        parsed = prefill.parse_offer("2 for $10 - 18.9 oz")
        self.assertEqual(parsed["price"], 5.0)
        self.assertEqual(parsed["deal"]["type"], "multi")


class PrefillTests(unittest.TestCase):
    @mock.patch("search.search")
    def test_flattens_blocks_and_parses(self, search_mock):
        search_mock.return_value = (
            [
                {
                    "retailer": "target",
                    "name": "Target",
                    "results": [
                        {
                            "title": "Fruity Pebbles 18.9 oz $6.49 | Target",
                            "url": "https://www.target.com/p/1",
                            "snippet": "",
                        },
                        {
                            "title": "No price here",
                            "url": "https://www.target.com/p/2",
                            "snippet": "",
                        },
                    ],
                },
                {
                    "retailer": "walgreens",
                    "name": "Walgreens",
                    "results": [
                        {
                            "title": "Fruity Pebbles 2 for $10 18.9 oz",
                            "url": "https://www.walgreens.com/p/1",
                            "snippet": "",
                        }
                    ],
                },
            ],
            ["amazon: TimeoutError: boom"],
        )
        candidates, errors = prefill.prefill("fruity pebbles")
        self.assertEqual(len(candidates), 2)
        self.assertEqual(candidates[0]["store"], "Target")
        self.assertEqual(candidates[0]["price"], 6.49)
        self.assertEqual(candidates[0]["size"], 18.9)
        self.assertEqual(candidates[1]["store"], "Walgreens")
        self.assertEqual(candidates[1]["deal"], {"type": "multi", "value": 2, "extra": 10})
        self.assertEqual(errors, ["amazon: TimeoutError: boom"])
        search_mock.assert_called_once_with("fruity pebbles", None)

    @mock.patch("search.search")
    def test_per_store_and_total_caps(self, search_mock):
        blocks = [
            {
                "retailer": "target",
                "name": "Target",
                "results": [
                    {"title": f"Item {i} 18.9 oz $6.49", "url": f"https://t/{i}", "snippet": ""}
                    for i in range(10)
                ],
            }
        ]
        search_mock.return_value = (blocks, [])
        candidates, _ = prefill.prefill("x", max_candidates=100, per_store=4)
        self.assertEqual(len(candidates), 4)

    @mock.patch("search.search")
    def test_empty_results(self, search_mock):
        search_mock.return_value = ([], [])
        candidates, errors = prefill.prefill("nothing")
        self.assertEqual(candidates, [])
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
