import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from scripts.orca_build import (
    TICKERS,
    build_bundle,
    clustering_coefficient,
    metrics_from_corr,
    validate_bundle,
    weighted_corr,
)


class OrcaBuildTests(unittest.TestCase):
    def test_weighted_corr_is_valid(self):
        rng = np.random.default_rng(42)
        values = rng.normal(size=(252, 24))
        matrix = weighted_corr(values)
        self.assertEqual(matrix.shape, (24, 24))
        self.assertTrue(np.allclose(matrix, matrix.T, atol=1e-10))
        self.assertTrue(np.allclose(np.diag(matrix), 1.0))
        self.assertLessEqual(float(np.abs(matrix).max()), 1.000001)

    def test_structural_metrics_ranges(self):
        matrix = np.eye(24)
        metrics = metrics_from_corr(matrix, 120)
        self.assertAlmostEqual(metrics["ar1"], 1 / 24, places=6)
        self.assertAlmostEqual(metrics["effective_rank"], 24, places=5)
        self.assertEqual(metrics["edge_density_05"], 0)
        self.assertEqual(metrics["clustering"], 0)

    def test_clustering_complete_graph(self):
        adjacency = np.ones((24, 24), dtype=int)
        np.fill_diagonal(adjacency, 0)
        self.assertAlmostEqual(clustering_coefficient(adjacency), 1.0)

    def test_demo_bundle(self):
        bundle = build_bundle("demo", "2015-01-01")
        validate_bundle(bundle)
        self.assertEqual(bundle["meta"]["universe_count"], len(TICKERS))
        self.assertEqual(len(bundle["assets"]), 24)
        self.assertGreater(len(bundle["history"]), 1000)
        self.assertIn(bundle["current"]["regime"], {"Normal", "Rally", "Caution", "Crisis", "Euphoria"})
        json.dumps(bundle, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
