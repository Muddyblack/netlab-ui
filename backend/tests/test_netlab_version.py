from services.netlab import runner


def test_parse_version_components():
    output = """netlab version 26.05

Required packages:
  python-box: 7.3.2
  Jinja2: 3.1.6

Optional packages:
  ruamel.yaml: 0.19.1

Ansible components:
  ansible: not installed
  ansible-core: not installed
"""

    assert runner.parse_version_components(output) == [
        {"name": "python-box", "version": "7.3.2", "category": "required", "installed": True},
        {"name": "Jinja2", "version": "3.1.6", "category": "required", "installed": True},
        {"name": "ruamel.yaml", "version": "0.19.1", "category": "optional", "installed": True},
        {"name": "ansible", "version": None, "category": "ansible", "installed": False},
        {"name": "ansible-core", "version": None, "category": "ansible", "installed": False},
    ]
